"""絵違い（イラスト違い）の対応表 data/alt-arts.js を作り直す（GitHub Actions で毎日実行）。

YGOPRODeck の card_images に、同じカードの別のイラストの画像番号が並んでいる。
カードの番号（パスワード）→ 絵違いの画像番号の配列。絵違いが無いカードは載せない。中身が変わったときだけ書き換える。
"""
import json
import pathlib
import urllib.request

UA = "ygo-practice/0.1 (daily alt art table; github actions)"
OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "alt-arts.js"


def main():
    req = urllib.request.Request("https://db.ygoprodeck.com/api/v7/cardinfo.php", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        cards = json.load(r)["data"]
    alts = {}
    for c in cards:
        ids = [im["id"] for im in c.get("card_images") or [] if isinstance(im.get("id"), int)]
        others = [i for i in ids if i != c["id"]]
        if others:
            alts[c["id"]] = sorted(set(others))
    if len(cards) < 10000 or len(alts) < 100:
        raise SystemExit(f"件数が少なすぎるため中止しました（カード {len(cards)} / 絵違い {len(alts)}）")
    body = ",".join(f"{k}:[{','.join(map(str, alts[k]))}]" for k in sorted(alts))
    js = (
        "// 絵違い（イラスト違い）の画像番号（GitHub Actions が毎日作り直す .github/scripts/build_alt_arts.py。手で書き換えない）\n"
        "// カードの番号 → 絵違いの画像番号の配列（YGOPRODeck の card_images）\n"
        f"const ALT_ARTS = {{{body}}};\n"
    )
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if old == js:
        print("変更なし")
        return
    OUT.write_text(js, encoding="utf-8")
    print(f"更新しました（絵違いのあるカード {len(alts)}枚）")


if __name__ == "__main__":
    main()
