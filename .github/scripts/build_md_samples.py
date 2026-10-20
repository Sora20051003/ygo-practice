# マスターデュエルのサンプルデッキ（data/md-samples.js）を作る。
# 禁止・制限リストの期間（レギュレーション）ごとに、Master Duel Meta の大会上位・高ランクのデッキから
# よく勝っているデッキタイプを選び、その代表のデッキを1つずつ入れる。
# アプリからは Master Duel Meta に直接つなげない（ブラウザからの読み込みが許可されていない）ので、ここで作っておく。
import os, json, time, urllib.request, urllib.parse, datetime, sys

UA = {'User-Agent': 'ygo-practice-sample-builder (github.com/Sora20051003/ygo-practice)'}
MDM = 'https://www.masterduelmeta.com/api/v1/top-decks'
REG_API = 'https://api.github.com/repos/DawnbrandBots/yaml-yugi-limit-regulation/contents/data/master-duel'
TYPES_PER_PERIOD = 20

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            print('retry', url[:120], e, file=sys.stderr)
            time.sleep(3 + i * 3)
    raise RuntimeError('failed: ' + url)

def q(params):
    return MDM + '?' + urllib.parse.urlencode(params)

# 大会の順位ほど重く数える（強さの目安）
PLACE = {'1st Place': 8, '2nd Place': 6, 'Top 4': 4, 'Top 8': 3, 'Top 16': 2, 'Top 32': 1.5}

def weight(d):
    t = d.get('tournamentType') or {}
    if t:
        if 'meme' in (t.get('name') or '').lower():
            return 0   # ネタデッキの大会は数えない
        return PLACE.get(d.get('tournamentPlacement') or '', 1)
    r = d.get('rankedType') or {}
    return 0.5 if r else 0

def main():
    files = get(REG_API)
    dates = sorted({f['name'][:10] for f in files if f['name'].endswith('.vector.json')})
    today = datetime.date.today().isoformat()
    dates = [d for d in dates if d <= today]
    # 英語のカード名 → カードのパスワード（YGOPRODeck）
    cards = get('https://db.ygoprodeck.com/api/v7/cardinfo.php')['data']
    by_name, by_key = {}, {}
    norm = lambda s: ''.join(ch for ch in s.lower() if ch.isalnum())
    for c in cards:
        # 同じ名前が何件かある（別番号のイラスト違いなど）ときは、いちばん小さい番号（元のカード）にする
        by_name[c['name']] = min(by_name.get(c['name'], c['id']), c['id'])
        by_key[norm(c['name'])] = min(by_key.get(norm(c['name']), c['id']), c['id'])
    # 前に作ったものがあれば、終わった期間はそのまま使う（毎日すべて取り直さない。新しい2つの期間だけ取り直す）
    old = {}
    try:
        with open('data/md-samples.js', encoding='utf-8') as fp:
            txt = fp.read()
        old = json.loads(txt[txt.index('{'):txt.rindex('}') + 1]).get('periods', {})
    except Exception:
        pass
    periods = {}
    for i, start in enumerate(dates):
        if start in old and i < len(dates) - 2 and not os.environ.get('FULL'):   # FULL=1 で全部作り直す
            periods[start] = old[start]
            continue
        end =dates[i + 1] if i + 1 < len(dates) else '2999-01-01'
        light = get(q({'created[$gte]': start, 'created[$lt]': end, 'limit': 1000,
                       'fields': 'created,deckType,tournamentType,rankedType,tournamentPlacement,url'}))
        time.sleep(1)
        score, best = {}, {}
        for d in light:
            t = (d.get('deckType') or {}).get('name')
            w = weight(d)
            if not t or w <= 0:
                continue
            score[t] = score.get(t, 0) + w
            # 代表：いちばん良い順位、同じなら新しいもの
            key = (w, d.get('created') or '')
            if t not in best or key > best[t][0]:
                best[t] = (key, d)
        top = sorted(score, key=lambda t: -score[t])[:TYPES_PER_PERIOD]
        if not top:
            continue
        ids = [best[t][1]['_id'] for t in top]
        full = {d['_id']: d for d in get(q({'_id[$in]': ','.join(ids), 'fields': 'main,extra', 'limit': 50}))}
        time.sleep(1)
        out = []
        for t in top:
            d = best[t][1]
            f = full.get(d['_id'])
            if not f:
                continue
            def conv(lst):
                res = []
                for e in lst or []:
                    name = (e.get('card') or {}).get('name') or ''
                    cid = by_name.get(name) or by_key.get(norm(name))
                    # 番号がアプリのカードデータと違うこともあるので、英語名も入れておく（3つ目）
                    res.append([cid, e.get('amount') or 1, name] if cid else [name, e.get('amount') or 1])
                return res
            tt = d.get('tournamentType') or {}
            src = (tt.get('name') + ' ' + (d.get('tournamentPlacement') or '')).strip() if tt else ((d.get('rankedType') or {}).get('name') or '')
            out.append({'t': t, 's': src, 'd': (d.get('created') or '')[:10], 'u': d.get('url') or '',
                        'p': round(score[t], 1), 'm': conv(f.get('main')), 'x': conv(f.get('extra'))})
        periods[start] = out
        print(start, len(light), 'decks ->', [o['t'] for o in out])
    js = ('// マスターデュエルのサンプルデッキ（.github/scripts/build_md_samples.py が自動で作る。手で書き換えない）\n'
          '// 禁止・制限リストの期間ごとに、Master Duel Meta（https://www.masterduelmeta.com/）の大会上位・高ランクのデッキから選んだもの。\n'
          '// m / x：[カードのパスワード（見つからない場合は英語名）, 枚数]、t：デッキタイプ、s：大会・ランク、d：日付、p：勝ち具合の点数\n'
          'const MD_SAMPLES = ' + json.dumps({'generated': today, 'periods': periods}, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open('data/md-samples.js', 'w', encoding='utf-8') as fp:
        fp.write(js)

main()
