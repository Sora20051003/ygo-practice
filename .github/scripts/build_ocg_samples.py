# OCG のサンプルデッキ（data/ocg-samples.js）を作る。
# OCG の禁止・制限リストの期間（レギュレーション）ごとに、大会で入賞したデッキからよく勝っているデッキタイプを選び、
# その代表のデッキを1つずつ入れる。データは YGOPRODeck の大会入賞デッキ（https://ygoprodeck.com/category/format/tournament%20meta%20decks%20ocg）。
#   k='ocg'：OCG の大会（2023年7月ごろから）
#   k='ae' ：アジアの英語版の大会（OCG に近いリスト）
#   k='tcg'：海外（TCG）の大会。OCG の入賞リストが少ない期間（2023年より前）だけ使う
#   k='wc' ：世界大会の優勝デッキ（2003〜2019年）。ほかのデータが無い期間だけ使う
# アプリで追加するとき、その期間の OCG の禁止・制限と発売日に合わせて枚数を直す。
import os, re, json, time, urllib.request, urllib.parse, datetime, sys, html

UA = {'User-Agent': 'ygo-practice-sample-builder (github.com/Sora20051003/ygo-practice)'}
DECKS = 'https://ygoprodeck.com/api/decks/getDecks.php'
REG_API = 'https://api.github.com/repos/DawnbrandBots/yaml-yugi-limit-regulation/contents/data/ocg'
TYPES_PER_PERIOD = 20
MIN_OCG = 10          # OCG の入賞リストがこれより少ない期間は、海外の大会のリストも使う
FULL = bool(os.environ.get('FULL'))
OUT = 'data/ocg-samples.js'

def get(url, tries=5, raw=False):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read().decode('utf-8')
                return b if raw else json.loads(b)
        except Exception as e:
            print('retry', url[:120], e, file=sys.stderr)
            time.sleep(3 + i * 4)
    raise RuntimeError('failed: ' + url)

MONTHS = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
DATE_RE = re.compile(r'\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?'
                     r'(?:\s*(?:-|–|&|and|to)\s*(?:[a-z]+\s+)?\d{1,2}(?:st|nd|rd|th)?)?,?\s+(\d{4})', re.I)

def deck_date(d):
    """大会の日付（説明文の「Tournament: 大会名 - October 4th 2026」から）。読めなければ None"""
    text = html.unescape(re.sub(r'<[^>]+>', '\n', d.get('deck_description') or ''))
    m = re.search(r'Tournament\s*:([^\n]*)', text)
    for s in ([m.group(1)] if m else []) + [text]:
        g = DATE_RE.search(s)
        if g:
            try:
                return datetime.date(int(g.group(3)), MONTHS[g.group(1).lower()[:3]], int(g.group(2))).isoformat()
            except ValueError:
                pass
    return None

def placement(d):
    p = (d.get('tournamentPlacement') or '')
    if not p:
        text = html.unescape(re.sub(r'<[^>]+>', '\n', d.get('deck_description') or ''))
        m = re.search(r'Placement\s*:([^\n]*)', text)
        p = m.group(1) if m else (d.get('deck_excerpt') or '')
    return p.strip()

def weight(d):
    p = placement(d).lower()
    if re.search(r'1st|champion|winner|優勝', p): w = 8
    elif re.search(r'2nd|runner', p): w = 6
    elif re.search(r'3rd|4th|top ?4\b', p): w = 4
    elif re.search(r'top ?8\b', p): w = 3
    elif re.search(r'top ?16\b', p): w = 2
    elif re.search(r'top ?32\b', p): w = 1.5
    else: w = 1
    n = d.get('tournamentPlayerCount') or 0
    if n:   # 参加人数が多い大会ほど少し重く
        w *= min(1.8, max(0.6, (n.bit_length()) / 6))
    return w

def deck_type(d):
    name = (d.get('deck_name') or '').strip()
    name = re.split(r'\s+/\s+|\s+-\s+(?:\d|1st|2nd|top)', name, maxsplit=1)[0].strip()
    name = re.sub(r'\s+(1st|2nd|3rd|top \d+)\b.*$', '', name, flags=re.I).strip()
    return name or '(名前なし)'

def fetch(fmt, stop_before=None, need_date=True):
    """そのカテゴリのデッキを新しい順に取る。stop_before の日付より古いページまで来たら止める"""
    out, off, seen = [], 0, set()
    while True:
        page = get(DECKS + '?' + urllib.parse.urlencode({'format': fmt, 'offset': off}))
        if not isinstance(page, list) or not page:
            break
        new = [d for d in page if d.get('deckNum') not in seen]
        if not new:
            break
        for d in new:
            seen.add(d.get('deckNum'))
            d['_date'] = deck_date(d)
        out += new
        off += len(page)
        time.sleep(0.25)
        if stop_before:
            ds = [d['_date'] for d in new if d['_date']]
            if ds and max(ds) < stop_before:
                break
    # 日付が読めないものは、番号が近いデッキの日付を使う（番号は登録順）
    known = sorted((d['deckNum'], d['_date']) for d in out if d['_date'] and d.get('deckNum'))
    for d in out:
        if not d['_date'] and known and d.get('deckNum'):
            near = min(known, key=lambda k: abs(k[0] - d['deckNum']))
            # 登録番号が近い（同じころに登録された）ときだけ、その日付を使う
            if abs(near[0] - d['deckNum']) <= 2000:
                d['_date'] = near[1]
    print(fmt, len(out), 'decks', file=sys.stderr)
    return [d for d in out if d["_date"] or not need_date]

def ids(s):
    try:
        return [int(x) for x in json.loads(s or '[]')]
    except Exception:
        return []

def main():
    files = get(REG_API)
    today = datetime.date.today().isoformat()
    starts = sorted({m.group(1) for f in files for m in [re.match(r'(\d{4}-\d{2}-\d{2})\.(vector|name)\.json$', f['name'])] if m and m.group(1) <= today})
    # カード番号 → 元のカード（イラスト違いの番号もまとめる）と英語名
    cards = get('https://db.ygoprodeck.com/api/v7/cardinfo.php')['data']
    canon = {}
    for c in cards:
        for im in c.get('card_images') or [{'id': c['id']}]:
            canon[im['id']] = (c['id'], c['name'])
        canon[c['id']] = (c['id'], c['name'])
    old = {}
    try:
        with open(OUT, encoding='utf-8') as fp:
            txt = fp.read()
        old = json.loads(txt[txt.index('{'):txt.rindex('}') + 1]).get('periods', {})
    except Exception:
        pass
    redo = starts if FULL or not old else starts[-2:]   # ふだんは新しい2つの期間だけ作り直す
    first = redo[0]
    pool = []
    for fmt, k in [('Tournament Meta Decks OCG', 'ocg'), ('Tournament Meta Decks OCG (Asian-English)', 'ae')]:
        pool += [dict(d, _k=k) for d in fetch(fmt, None if FULL or not old else first)]
    # 海外の大会：ふだんは新しい期間の分だけ（OCG の入賞リストが少ない期間の穴埋め）
    pool += [dict(d, _k='tcg') for d in fetch('Tournament Meta Decks', None if FULL or not old else first)]
    if FULL or not old:
        for d in fetch("World Championship Decks", need_date=False):
            y = re.search(r'(20\d\d)', d.get('deck_name') or '')
            if y:
                pool.append(dict(d, _k='wc', _date=y.group(1) + '-08-15'))   # 世界大会はだいたい8月
    period_of = lambda day: max([s for s in starts if s <= day], default=None)
    by = {}
    for d in pool:
        p = period_of(d['_date'])
        if p in redo:
            by.setdefault(p, []).append(d)
    periods = {p: old[p] for p in starts if p in old and p not in redo}
    for p in redo:
        ds = by.get(p, [])
        ocg = [d for d in ds if d['_k'] in ('ocg', 'ae')]
        use = ocg if len(ocg) >= MIN_OCG else (ocg + [d for d in ds if d['_k'] == 'tcg'])
        if not use:
            use = [d for d in ds if d['_k'] == 'wc']
        if not use:
            if p in old:
                periods[p] = old[p]
            continue
        score, best, count = {}, {}, {}
        for d in use:
            t = deck_type(d)
            key = t.lower()
            w = weight(d) * (1 if d['_k'] in ('ocg', 'ae', 'wc') else 0.8)
            score[key] = score.get(key, 0) + w
            count[key] = count.get(key, 0) + 1
            rank = (d['_k'] in ('ocg', 'ae'), weight(d), d['_date'], d.get('deckNum') or 0)
            if key not in best or rank > best[key][0]:
                best[key] = (rank, d, t)
        out = []
        # OCG（とアジア）の大会で入賞したデッキタイプを先に、足りない分を海外の大会から
        is_ocg = lambda k: best[k][1]['_k'] in ('ocg', 'ae')
        order = sorted(score, key=lambda k: (not is_ocg(k), -score[k]))
        for key in order[:TYPES_PER_PERIOD]:
            d, t = best[key][1], best[key][2]
            def conv(lst):
                cnt = {}
                order = []
                for i in ids(lst):
                    cid, name = canon.get(i, (i, ''))
                    if cid not in cnt:
                        order.append((cid, name))
                    cnt[cid] = cnt.get(cid, 0) + 1
                return [[cid, cnt[cid], name] if name else [cid, cnt[cid]] for cid, name in order]
            src = ' '.join(x for x in [d.get('tournamentName') or '', placement(d)] if x) if d['_k'] != 'wc' else (d.get('deck_name') or '')
            if not d.get('tournamentName') and d['_k'] != 'wc':
                src = (d.get('deck_excerpt') or '').split('/', 1)[-1].strip() or src
            out.append({'t': t, 'k': d['_k'], 's': src[:120], 'd': d['_date'], 'u': 'https://ygoprodeck.com/deck/' + (d.get('pretty_url') or ''),
                        'p': round(score[key], 1), 'c': count[key], 'm': conv(d.get('main_deck')), 'x': conv(d.get('extra_deck'))})
        periods[p] = out
        print(p, len(use), 'decks ->', [(o['t'], o['k']) for o in out], file=sys.stderr)
    js = ('// OCG のサンプルデッキ（.github/scripts/build_ocg_samples.py が自動で作る。手で書き換えない）\n'
          '// 禁止・制限リストの期間ごとに、YGOPRODeck（https://ygoprodeck.com/）の大会入賞デッキから選んだもの。\n'
          '// k：ocg＝OCGの大会 / ae＝アジアの英語版の大会 / tcg＝海外の大会 / wc＝世界大会の優勝デッキ\n'
          '// m / x：[カードのパスワード, 枚数, 英語名]、t：デッキタイプ、s：大会・順位、d：日付、p：勝ち具合の点数、c：その期間の入賞数\n'
          'const OCG_SAMPLES = ' + json.dumps({'generated': today, 'periods': dict(sorted(periods.items()))}, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open(OUT, 'w', encoding='utf-8') as fp:
        fp.write(js)

main()
