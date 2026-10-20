# 効果を自動処理するときの「効果の説明」（選択肢の文）の表 data/edo-strs.js を作る。
# 自動処理は EDOPro のスクリプトで動くので、説明の番号（aux.Stringid(カード, 番号)）は EDOPro のカードデータの並び。
# 日本語の説明（mycard の YGOPro 用）は並びや数が違うことが多いので、そのまま使うと別の効果の説明が出てしまう。
# そこで、EDOPro の英語の説明と mycard の英語の説明が同じ番号（無ければ別の番号）で一致するときだけ、その日本語を使う。
# 一致しないものは、よくある短い言い回しは日本語に直し、それ以外は EDOPro の英語のまま出す。
import json, re, sqlite3, tempfile, urllib.request, datetime, os, sys

UA = {'User-Agent': 'ygo-practice-strs-builder (github.com/Sora20051003/ygo-practice)'}
EDO = 'https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/master/cards.cdb'
MC_EN = 'https://raw.githubusercontent.com/mycard/ygopro-database/master/locales/en-US/cards.cdb'
MC_JA = 'https://raw.githubusercontent.com/mycard/ygopro-database/master/locales/ja-JP/cards.cdb'
OUT = 'data/edo-strs.js'

# よくある短い言い回し（まるごと一致したときだけ置きかえる）
PHRASES = {
    'special summon': '特殊召喚する', 'special summon this card': 'このカードを特殊召喚する', 'special summon it': '特殊召喚する',
    'add to hand': '手札に加える', 'add to your hand': '手札に加える', 'add 1 card to your hand': '1枚を手札に加える', 'search': 'デッキから手札に加える',
    'draw': 'ドローする', 'draw 1 card': '1枚ドローする', 'draw 2 cards': '2枚ドローする', 'destroy': '破壊する', 'destroy 1 card': '1枚を破壊する',
    'banish': '除外する', 'send to the gy': '墓地へ送る', 'send to gy': '墓地へ送る', 'negate': '無効にする', 'negate the activation': '発動を無効にする',
    'negate the effect': '効果を無効にする', 'negate that effect': 'その効果を無効にする', 'negate that activation': 'その発動を無効にする', 'negate the summon': '召喚を無効にする', 'set': 'セットする', 'set 1 spell/trap': '魔法・罠を1枚セットする', 'change battle position': '表示形式を変更する',
    'change position': '表示形式を変更する', 'gain lp': 'LPを回復する', 'inflict damage': 'ダメージを与える', 'return to hand': '手札に戻す',
    'return to the hand': '手札に戻す', 'return to the deck': 'デッキに戻す', 'shuffle into the deck': 'デッキに戻す', 'attach': 'X素材にする',
    'attach material': 'X素材にする', 'detach': 'X素材を取り除く', 'equip': '装備する', 'take control': 'コントロールを得る',
    'gain atk': '攻撃力を上げる', 'increase atk': '攻撃力を上げる', 'decrease atk': '攻撃力を下げる', 'lose atk': '攻撃力を下げる',
    'fusion summon': '融合召喚する', 'synchro summon': 'シンクロ召喚する', 'xyz summon': 'エクシーズ召喚する', 'link summon': 'リンク召喚する',
    'ritual summon': '儀式召喚する', 'normal summon': '通常召喚する', 'tribute': 'リリースする', 'excavate': 'めくる', 'mill': 'デッキから墓地へ送る',
    'place in the pendulum zone': 'ペンデュラムゾーンに置く', 'place in pendulum zone': 'ペンデュラムゾーンに置く', 'activate': '発動する',
    'apply the effect': '効果を適用する', 'recover': '回復する', 'look at hand': '手札を見る', 'reveal': '公開する', 'change name': 'カード名を変更する',
    'change level': 'レベルを変更する', 'change attribute': '属性を変更する', 'gain control': 'コントロールを得る', 'add counter': 'カウンターを置く',
}

# よくある形の英語の説明（数やだれのが入るもの）を日本語に直す。まるごと一致したときだけ
WHO = {'your': '自分の', "your opponent's": '相手の', "their": '相手の', 'either': 'どちらかの', 'each': 'お互いの'}
PATTERNS = [
    (r"send the top (\d+) cards? of (your|your opponent's|their|either|each) deck to the (?:gy|graveyard)", lambda m: f"{WHO[m[2]]}デッキの上から{m[1]}枚を墓地へ送る"),
    (r"send the top (\d+) cards? of (your|your opponent's|their|either|each) deck", lambda m: f"{WHO[m[2]]}デッキの上から{m[1]}枚を墓地へ送る"),
    (r"send the top card of (your|your opponent's|their|either|each) deck to the (?:gy|graveyard)", lambda m: f"{WHO[m[1]]}デッキの上から1枚を墓地へ送る"),
    (r"draw (\d+) cards?", lambda m: f"{m[1]}枚ドローする"),
    (r"special summon (?:it|this card|that monster)", lambda m: '特殊召喚する'),
    (r"special summon (?:it|this card) to your field", lambda m: '自分フィールドに特殊召喚する'),
    (r"special summon (?:it|this card) to your opponent's field", lambda m: '相手フィールドに特殊召喚する'),
    (r"banish (?:it|this card)", lambda m: '除外する'),
    (r"destroy (?:it|this card)", lambda m: '破壊する'),
    (r"inflict (\d+) damage(?: to your opponent)?", lambda m: f"相手に{m[1]}ダメージを与える"),
    (r"gain (\d+) lp", lambda m: f"{m[1]}LP回復する"),
    (r"take (\d+) damage", lambda m: f"{m[1]}ダメージを受ける"),
]
def translate(s):
    t = s.lower().strip().rstrip('.?')
    if t in PHRASES:
        return PHRASES[t]
    for pat, f in PATTERNS:
        m = re.fullmatch(pat, t)
        if m:
            return f(m) + ('？' if s.strip().endswith('?') else '')
    return None

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()

def strs(data):
    with tempfile.NamedTemporaryFile(delete=False, suffix='.cdb') as f:
        f.write(data); path = f.name
    try:
        con = sqlite3.connect(path)
        cols = ','.join('str%d' % i for i in range(1, 17))
        out = {}
        for row in con.execute('select id,' + cols + ' from texts'):
            ss = [(s or '').strip() for s in row[1:]]
            if any(ss):
                out[row[0]] = ss
        con.close()
        return out
    finally:
        os.unlink(path)

norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())

# 言い回しが違うだけのもの（「Special Summon」と「Special Summon 1 Level 7 or lower ... monster」など）も同じとみなすための似ている度合い
STOP = set('a an the of to your you this that it its card cards 1 2 3 from or and in on by with for if is are be can'.split())
def words(s):
    return {w for w in re.findall(r'[a-z]+', re.sub(r'\bgy\b', 'graveyard', s.lower())) if w not in STOP}
# 意味が変わる違い（数・だれの、など）。片方にしか無い／食い違うときは別の説明とみなす
# 例：「Send the top 2 cards of your Deck」と「Send the top 3 cards of your opponent's Deck」は別
# だれの（自分・相手・両方）：「your Deck」「your opponent's field」「you control」などの言い回しだけを見る
OWN_RE = re.compile(r"\b(your opponent's|opponent's|their|your|either|both players'|each player's|both)\s+(?:extra\s+)?(deck|field|side of the field|graveyard|gy|hand)\b|\b(your opponent|you)\s+controls?\b")
def owner(t):
    s = set()
    for m in OWN_RE.finditer(t):
        w = m.group(1) or m.group(3)
        s.add('opp' if re.search(r'opponent|their', w) else 'either' if re.search(r'either|both|each', w) else 'you')
    return s
def features(s):
    t = s.lower()
    return {'num': set(re.findall(r'\d+', t)), 'owner': owner(t)}
def conflict(a, b):
    # 数が1つも同じでない・だれのが1つも同じでないときは別の説明（例：「自分のデッキの上から2枚」と「相手のデッキの上から3枚」）
    fa, fb = features(a), features(b)
    if fa['num'] and fb['num'] and not (fa['num'] & fb['num']):
        return True
    return bool(fa['owner'] and fb['owner'] and not (fa['owner'] & fb['owner']))
def jowner(s):
    if re.search(r'お互い|両方', s):
        return 'either'
    if '相手' in s and '自分' not in s:
        return 'opp'
    if '自分' in s and '相手' not in s:
        return 'you'
    return None
def sim(a, b):
    A, B = words(a), words(b)
    if not A or not B or conflict(a, b):
        return 0
    # 似ている度合い（短い方がどれだけ含まれるか）。同じくらいなら、全体でより多く重なる方を選ぶ
    return len(A & B) / min(len(A), len(B)) + 0.1 * len(A & B) / len(A | B)

def main():
    edo, en, ja = strs(get(EDO)), strs(get(MC_EN)), strs(get(MC_JA))
    print('EDOPro', len(edo), 'mycard en', len(en), 'ja', len(ja), file=sys.stderr)
    table, stat = {}, {'ja': 0, 'phrase': 0, 'en': 0}
    for cid, d in edo.items():
        e, j = en.get(cid) or [''] * 16, ja.get(cid) or [''] * 16
        # mycard の英語と日本語で説明の数が違うカードは、並びが合っていない（別の説明がずれて入っている）ことがあるので日本語を使わない
        if sum(1 for x in e if x) != sum(1 for x in j if x):
            j = [''] * 16
        # EDOPro の説明 i ↔ mycard の説明 k の対応。同じ文 → 似ている文の順に、1つの日本語は1つの説明にだけ使う
        # （同じ日本語が2つの選択肢に出て見分けられなくなるのを防ぐ）。「Affected by …」（適用中の効果の表示）は対応させない
        pairs = []
        for i, s in enumerate(d):
            if not s or s.lower().startswith('affected by'):
                continue
            eo = owner(s.lower())
            for k, x in enumerate(e):
                if not x or not j[k]:
                    continue
                # 日本語の説明が「自分」「相手」のどちらかだけを言っていて、英語と食い違うものは使わない
                jo = jowner(j[k])
                if jo and (not eo or jo not in eo):
                    continue
                if norm(x) == norm(s):
                    pairs.append((2.0 + (k == i), i, k))
                else:
                    sc = sim(s, x)
                    if sc >= 0.75:
                        pairs.append((sc + 0.01 * (k == i), i, k))
        pairs.sort(reverse=True)
        got, used = {}, set()
        for sc, i, k in pairs:
            if i in got or k in used:
                continue
            got[i] = (k, sc >= 2)
            used.add(k)
        row = []
        for i, s in enumerate(d):
            if not s:
                row.append('')
                continue
            if i in got:
                label = j[got[i][0]]
                stat['ja'] += 1
                if not got[i][1]:
                    stat['similar'] = stat.get('similar', 0) + 1
            elif translate(s):
                label = translate(s); stat['phrase'] += 1
            else:
                label = s; stat['en'] += 1
            row.append(label)
        while row and not row[-1]:
            row.pop()
        if row:
            table[cid] = row
    print(stat, file=sys.stderr)
    if len(table) < 5000:
        raise SystemExit('件数が少なすぎるため中止しました')
    js = ('// 効果を自動処理するときの「効果の説明」（.github/scripts/build_edo_strs.py が自動で作る。手で書き換えない）\n'
          '// カードのパスワード → EDOPro の説明の番号順の文。日本語が対応づけられないものは英語のまま\n'
          'const EDO_STRS = ' + json.dumps(table, ensure_ascii=False, separators=(',', ':')) + ';\n')
    old = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
    if old.split('\n', 2)[-1:] == js.split('\n', 2)[-1:]:
        print('変更なし', file=sys.stderr)
        return
    with open(OUT, 'w', encoding='utf-8') as fp:
        fp.write(js)

main()
