# マスターデュエルの使用率のデータ（data/md-usage.js）を作る。初動率の計算で、相手のデッキとして使う。
# Master Duel Meta（https://www.masterduelmeta.com/）に載った、今の禁止・制限リストの期間の大会・ランク戦のデッキを全部取り、
# メインデッキの中身をそのまま入れる（アプリが手札誘発・0ターン展開の採用率を数え、相手の初手を配るのに使う）。
# デッキが少ないとき（期間が始まったばかり）は、1つ前の期間のデッキも足す。
import json, time, urllib.request, urllib.parse, datetime, sys

UA = {'User-Agent': 'ygo-practice-usage-builder (github.com/Sora20051003/ygo-practice)'}
MDM = 'https://www.masterduelmeta.com/api/v1/top-decks'
REG_API = 'https://api.github.com/repos/DawnbrandBots/yaml-yugi-limit-regulation/contents/data/master-duel'
MIN_DECKS = 150


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            print('retry', url[:120], e, file=sys.stderr)
            time.sleep(3 + i * 3)
    raise RuntimeError('failed: ' + url)


def q(params):
    return MDM + '?' + urllib.parse.urlencode(params)


def counted(d):
    # ネタデッキの大会は数えない
    t = d.get('tournamentType') or {}
    if t:
        return 'meme' not in (t.get('name') or '').lower()
    return bool(d.get('rankedType'))


def light_list(start, end):
    # 1回で取れる数に限りがあるので、7日ずつに分けて取る
    out, seen = [], set()
    day = datetime.date.fromisoformat(start)
    last = datetime.date.fromisoformat(end)
    while day < last:
        nxt = min(day + datetime.timedelta(days=7), last)
        part = get(q({'created[$gte]': day.isoformat(), 'created[$lt]': nxt.isoformat(), 'limit': 1000,
                      'fields': 'created,deckType,tournamentType,rankedType'}))
        time.sleep(1)
        for d in part:
            if d['_id'] not in seen and counted(d):
                seen.add(d['_id'])
                out.append(d)
        day = nxt
    return out


def main():
    files = get(REG_API)
    today = datetime.date.today()
    dates = sorted({f['name'][:10] for f in files if f['name'].endswith('.vector.json') and f['name'][:10] <= today.isoformat()})
    if not dates:
        print('リストの日付がありません')
        return
    end = (today + datetime.timedelta(days=1)).isoformat()
    start = dates[-1]
    decks = light_list(start, end)
    if len(decks) < MIN_DECKS and len(dates) > 1:
        start = dates[-2]
        decks = light_list(start, dates[-1]) + decks
    print('期間', start, '〜', 'デッキ', len(decks))

    # 英語のカード名 → カードのパスワード（YGOPRODeck）
    cards = get('https://db.ygoprodeck.com/api/v7/cardinfo.php')['data']
    by_name, by_key = {}, {}
    norm = lambda s: ''.join(ch for ch in s.lower() if ch.isalnum())
    for c in cards:
        by_name[c['name']] = min(by_name.get(c['name'], c['id']), c['id'])
        by_key[norm(c['name'])] = min(by_key.get(norm(c['name']), c['id']), c['id'])

    # メインデッキの中身（50個ずつ）
    table, index, out, types = [], {}, [], {}
    ids = [d['_id'] for d in decks]
    kind = {d['_id']: ('t' if d.get('tournamentType') else 'r') for d in decks}
    dtype = {d['_id']: (d.get('deckType') or {}).get('name') or '' for d in decks}
    for i in range(0, len(ids), 50):
        part = get(q({'_id[$in]': ','.join(ids[i:i + 50]), 'fields': 'main', 'limit': 50}))
        time.sleep(1)
        for d in part:
            flat = []
            for e in d.get('main') or []:
                name = (e.get('card') or {}).get('name') or ''
                if not name:
                    continue
                key = by_name.get(name) or by_key.get(norm(name)) or name   # 番号が分からないときは英語名
                if key not in index:
                    index[key] = len(table)
                    table.append(key)
                flat += [index[key], e.get('amount') or 1]
            if sum(flat[1::2]) < 40:
                continue
            t = dtype.get(d['_id'], '')
            types[t] = types.get(t, 0) + 1
            out.append([kind.get(d['_id'], 'r'), t] + flat)
    data = {'generated': today.isoformat(), 'from': start, 'n': len(out), 'cards': table, 'decks': out,
            'types': dict(sorted(types.items(), key=lambda x: -x[1]))}
    js = ('// マスターデュエルの使用率（.github/scripts/build_md_usage.py が毎日自動で作る。手で書き換えない）\n'
          '// Master Duel Meta に載った、今の禁止・制限リストの期間の大会・ランク戦のデッキ全部。\n'
          '// cards：カードのパスワード（分からないものは英語名）、decks：[t=大会 / r=ランク戦, デッキタイプ, カードの番号（cards の位置）, 枚数, …]\n'
          'const MD_USAGE = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open('data/md-usage.js', 'w', encoding='utf-8') as fp:
        fp.write(js)
    print('書き出し', len(out), 'デッキ・カード', len(table), '種類')


main()
