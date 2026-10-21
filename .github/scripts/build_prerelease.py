"""発売前（情報が出ている）のカードの表 data/prerelease-cards.js を作り直す（GitHub Actions で毎日実行）。

カードの値（種類・攻守など）と効果の処理（スクリプト）は EDOPro の発売前のデータ（ProjectIgnis/BabelCDB の prerelease-*.cdb）から。
日本語の名前・読み・効果文は ocg-card.com の収録リストから取る。
  ・収録パックの番号（例：RV02-JP026）と EDOPro の仮の番号（例：100460026 の下3桁）が同じものを対応させる
  ・パックの分からないカード（prerelease-others など）は、発売予定の商品の収録リストから、属性・レベル・種族・攻守が同じカードを探す
アプリのカードデータ（ygocdb）にもう入っているカード（同じ名前）は入れない。
ただし番号がちがうとき（ygocdb の仮の番号）は、効果の処理に EDOPro の番号のスクリプトを使えるよう PRE_MAP に対応を書く。
中身が変わったときだけファイルを書き換える。
"""
import html
import io
import json
import pathlib
import re
import sqlite3
import tempfile
import urllib.request
import zipfile

UA = "Mozilla/5.0 (ygo-practice; daily prerelease card data; github actions)"
OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "prerelease-cards.js"
API = "https://api.github.com/repos/ProjectIgnis/BabelCDB/contents/"
RAW = "https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/master/"
LIST = "https://ocg-card.com/list/{}/"
LATEST = "https://ocg-card.com/latest/"

ATTR = {1: "地", 2: "水", 4: "炎", 8: "風", 16: "光", 32: "闇", 64: "神"}
RACES = ["戦士族", "魔法使い族", "天使族", "悪魔族", "アンデット族", "機械族", "水族", "炎族", "岩石族", "鳥獣族", "植物族", "昆虫族",
         "雷族", "ドラゴン族", "獣族", "獣戦士族", "恐竜族", "魚族", "海竜族", "爬虫類族", "サイキック族", "幻神獣族", "創造神族",
         "幻竜族", "サイバース族", "幻想魔族"]
TYPE_MONSTER, TYPE_LINK = 0x1, 0x4000000


def fetch(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def strip(s):
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


# ocg-card.com の収録リスト：番号 → { name, ruby, attr, star, race, atk, def, text }
def parse_list(page):
    out = {}
    rows = re.split(r'<td class="card-number"[^>]*>', page)[1:]
    for row in rows:
        m = re.match(r"\s*([A-Z0-9]+-[A-Z]{2}\d+)\s*</td>", row)
        if not m:
            continue
        num = m.group(1)
        nm = re.search(r'<td class="[^"]*" rowspan="2">(?:<div class="card-ruby">(.*?)</div>)?(.*?)</td>', row, re.S)
        if not nm or num in out:
            continue
        get = lambda cls: (lambda x: strip(x.group(1)) if x else "")(re.search(rf'<td class="{cls}"[^>]*>(.*?)</td>', row, re.S))
        forces = [strip(x) for x in re.findall(r'<td class="card-force"[^>]*>(.*?)</td>', row, re.S)]
        text = re.search(r'<td class="card-text"[^>]*>(.*?)</td>', row, re.S)
        out[num] = {
            "name": strip(nm.group(2)), "ruby": strip(nm.group(1) or ""),
            "attr": get("card-attr"), "star": get("card-star"), "race": get("card-type"),
            "atk": forces[0] if forces else "", "def": forces[1] if len(forces) > 1 else "",
            "text": strip(text.group(1)) if text else "",
        }
    return out


def race_ja(race):
    for i, n in enumerate(RACES):
        if race == 1 << i:
            return n
    return ""


def num_ja(v):
    return "?" if v == -2 else str(v)


def main():
    files = [x["name"] for x in json.loads(fetch(API))]
    files = [n for n in files if n.startswith("prerelease-") and n.endswith(".cdb") and "rush" not in n]
    # 発売予定の商品の収録リスト（パックの分からないカードを探すため）
    latest = fetch(LATEST).decode("utf-8", "replace")
    codes = sorted(set(c for c in re.findall(r"ocg-card\.com/latest/([a-z0-9]+)/", latest) if not re.fullmatch(r"\d{4}", c) and c not in ("feed", "page")))
    lists = {}

    def list_of(code):
        if code not in lists:
            try:
                lists[code] = parse_list(fetch(LIST.format(code)).decode("utf-8", "replace"))
            except Exception as e:
                print(f"収録リストを読めませんでした（{code}）：{e}")
                lists[code] = {}
        return lists[code]

    # アプリのカードデータ（ygocdb）：日本語の名前 → 番号
    z = zipfile.ZipFile(io.BytesIO(fetch("https://ygocdb.com/api/v0/cards.zip", 180)))
    ycdb = json.loads(z.read(z.namelist()[0]))
    have = {}
    for e in ycdb.values():
        if e.get("jp_name"):
            have[re.sub(r"\s", "", e["jp_name"])] = e.get("id")

    cards, pre_map, done = [], {}, set()
    for f in files:
        code = f[len("prerelease-"):-len(".cdb")]
        own = list_of(code) if re.fullmatch(r"[a-z0-9]+", code) and code != "others" else {}
        with tempfile.NamedTemporaryFile(suffix=".cdb", delete=False) as tmp:
            tmp.write(fetch(RAW + f))
            path = tmp.name
        db = sqlite3.connect(path)
        rows = db.execute("select d.id, d.alias, d.type, d.level, d.race, d.attribute, d.atk, d.def, t.name, t.desc "
                          "from datas d join texts t on d.id = t.id").fetchall()
        db.close()
        for cid, alias, typ, lv, race, attr, atk, df, en, desc in rows:
            if alias or cid in done:
                continue   # 絵違い（別の番号の同じカード）は入れない
            done.add(cid)
            ja = None
            # 収録パックの番号で対応させる（EDOPro の仮の番号の下3桁 ＝ パックの中の番号）
            for num, x in own.items():
                if int(re.sub(r"\D", "", num.split("-")[1]) or -1) == cid % 1000:
                    ja = x
                    break
            # パックの分からないカード：発売予定の商品の収録リストから、モンスターの値が同じカードを探す
            if not ja and typ & TYPE_MONSTER:
                key = (ATTR.get(attr, ""), str(lv & 0xFF), race_ja(race), num_ja(atk), "-" if typ & TYPE_LINK else num_ja(df))
                hits = [x for c in codes for x in list_of(c).values()
                        if (x["attr"], x["star"], x["race"], x["atk"], x["def"] if x["def"] else "-") == key]
                if len({h["name"] for h in hits}) == 1:
                    ja = hits[0]
            name = ja["name"] if ja else en
            key = re.sub(r"\s", "", name)
            if key in have:
                if have[key] != cid:
                    pre_map[have[key]] = cid   # アプリのデータでは別の仮の番号：効果の処理はこちらの番号のスクリプトを使う
                continue
            cards.append([cid, typ, lv, race, attr, atk, df, name, ja["ruby"] if ja else "", en,
                          ja["text"] if ja else desc, code.upper(), 0 if ja else 1])
    cards.sort()
    if not cards and not pre_map:
        print("発売前のカードがありませんでした")
    js = (
        "// 発売前（情報が出ている）のカード（GitHub Actions が毎日作り直す .github/scripts/build_prerelease.py。手で書き換えない）\n"
        "// PRE_CARDS：[番号, 種類, レベル, 種族, 属性, 攻撃力, 守備力, 名前, 読み, 英語名, 効果文, 収録（EDOPro のデータの名前）, 日本語が無い(1)]\n"
        "// PRE_MAP：アプリのカードデータの仮の番号 → EDOPro の発売前のデータの番号（効果の処理に使う）\n"
        f"const PRE_CARDS = {json.dumps(cards, ensure_ascii=False, separators=(',', ':'))};\n"
        f"const PRE_MAP = {json.dumps({str(k): v for k, v in sorted(pre_map.items())}, separators=(',', ':'))};\n"
    )
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if old == js:
        print("変更なし")
        return
    OUT.write_text(js, encoding="utf-8")
    print(f"更新しました（発売前のカード {len(cards)}枚・番号の対応 {len(pre_map)}枚）")


if __name__ == "__main__":
    main()
