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
    'negate the effect': '効果を無効にする', 'set': 'セットする', 'set 1 spell/trap': '魔法・罠を1枚セットする', 'change battle position': '表示形式を変更する',
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
def sim(a, b):
    A, B = words(a), words(b)
    if not A or not B:
        return 0
    return len(A & B) / min(len(A), len(B))

def main():
    edo, en, ja = strs(get(EDO)), strs(get(MC_EN)), strs(get(MC_JA))
    print('EDOPro', len(edo), 'mycard en', len(en), 'ja', len(ja), file=sys.stderr)
    table, stat = {}, {'ja': 0, 'phrase': 0, 'en': 0}
    for cid, d in edo.items():
        e, j = en.get(cid) or [''] * 16, ja.get(cid) or [''] * 16
        row = []
        for i, s in enumerate(d):
            if not s:
                row.append('')
                continue
            label = None
            if j[i] and norm(e[i]) == norm(s):
                label = j[i]                                    # 同じ番号で一致
            else:
                for k, x in enumerate(e):                        # 別の番号で一致
                    if x and j[k] and norm(x) == norm(s):
                        label = j[k]; break
            if not label:
                # 言い回しが違うだけ：いちばん似ている説明（同じ点なら同じ番号を優先）。十分似ていて、ほかの説明とはっきり区別できるときだけ
                cands = sorted(((sim(s, x), k == i, k) for k, x in enumerate(e) if x and j[k]), reverse=True)
                if cands and cands[0][0] >= 0.75 and (len(cands) == 1 or cands[0][0] - cands[1][0] >= 0.25 or cands[0][1]):
                    label = j[cands[0][2]]; stat['similar'] = stat.get('similar', 0) + 1
            if label:
                stat['ja'] += 1
            elif s.lower().rstrip('.') in PHRASES:
                label = PHRASES[s.lower().rstrip('.')]; stat['phrase'] += 1
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
