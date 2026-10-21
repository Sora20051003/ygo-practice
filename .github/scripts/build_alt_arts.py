"""絵違い（イラスト違い）の対応表 data/alt-arts.js を作り直す（GitHub Actions で毎日実行）。

絵違いの画像番号は2か所から集める。
  ・YGOPRODeck の card_images（同じカードの別のイラスト）
  ・EDOPro のカードデータ（data/edo-cards.js）で、元のカードと同じ内容の別番号（alias）。番号が近いものだけ（別名のカードは除く）
画像があるかを確かめ、YGOPRODeck のイラスト画像（切り抜き済み）が無く、EDOPro の画像（カード全体）だけがあるものは ALT_FULL に入れる
（アプリはカード全体の画像からイラストの部分だけを切り出して表示する）。どちらにも画像が無いものは載せない。
中身が変わったときだけ書き換える。
"""
import concurrent.futures
import json
import pathlib
import urllib.error
import urllib.request

UA = "ygo-practice/0.1 (daily alt art table; github actions)"
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "alt-arts.js"
EDO = ROOT / "data" / "edo-cards.js"
YGO_ART = "https://images.ygoprodeck.com/images/cards_cropped/{}.jpg"
IGNIS_FULL = "https://pics.projectignis.org:2096/pics/{}.jpg"


def exists(url):
    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status == 200 and "image" in (r.headers.get("Content-Type") or "image")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False
        except Exception:
            pass
    return False


def main():
    req = urllib.request.Request("https://db.ygoprodeck.com/api/v7/cardinfo.php", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        cards = json.load(r)["data"]
    known = {c["id"] for c in cards}
    alts = {}
    for c in cards:
        for im in c.get("card_images") or []:
            i = im.get("id")
            if isinstance(i, int) and i != c["id"]:
                alts.setdefault(c["id"], set()).add(i)
    ygo_listed = {i for s in alts.values() for i in s}

    # EDOPro のデータ：alias が元のカードで、内容（種類・攻守など）が同じ、番号の近いもの
    if EDO.exists():
        text = EDO.read_text(encoding="utf-8")
        d = json.loads(text[text.index("{"): text.rindex("}") + 1])["d"]
        for k, v in d.items():
            if not isinstance(v, list) or not v[0]:
                continue
            orig = v[0]
            o = d.get(str(orig))
            if not o or o[1:] != v[1:] or abs(int(k) - orig) >= 100 or orig not in known:
                continue
            alts.setdefault(orig, set()).add(int(k))

    # 画像があるかを確かめる（YGOPRODeck が一覧に載せているものは確かめない）
    check = sorted({i for s in alts.values() for i in s} - ygo_listed)
    full, missing = set(), set()

    def probe(i):
        if exists(YGO_ART.format(i)):
            return i, "art"
        if exists(IGNIS_FULL.format(i)):
            return i, "full"
        return i, None

    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for i, kind in ex.map(probe, check):
            if kind == "full":
                full.add(i)
            elif kind is None:
                missing.add(i)
    alts = {k: sorted(s - missing) for k, s in alts.items()}
    alts = {k: v for k, v in alts.items() if v}

    if len(cards) < 10000 or len(alts) < 100:
        raise SystemExit(f"件数が少なすぎるため中止しました（カード {len(cards)} / 絵違い {len(alts)}）")
    body = ",".join(f"{k}:[{','.join(map(str, alts[k]))}]" for k in sorted(alts))
    js = (
        "// 絵違い（イラスト違い）の画像番号（GitHub Actions が毎日作り直す .github/scripts/build_alt_arts.py。手で書き換えない）\n"
        "// ALT_ARTS：カードの番号 → 絵違いの画像番号の配列（YGOPRODeck の card_images と EDOPro のデータから）\n"
        "// ALT_FULL：イラストの画像が無く、カード全体の画像（EDOPro）からイラストを切り出して表示する番号\n"
        f"const ALT_ARTS = {{{body}}};\n"
        f"const ALT_FULL = [{','.join(map(str, sorted(full)))}];\n"
    )
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if old == js:
        print("変更なし")
        return
    OUT.write_text(js, encoding="utf-8")
    print(f"更新しました（絵違いのあるカード {len(alts)}枚・カード全体の画像から切り出す {len(full)}枚・画像なしで除外 {len(missing)}枚）")


if __name__ == "__main__":
    main()
