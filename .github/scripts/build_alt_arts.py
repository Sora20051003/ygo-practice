"""絵違い（イラスト違い）の対応表 data/alt-arts.js を作り直す（GitHub Actions で毎日実行）。

絵違いの画像番号は次の3つから集める。
  ・YGOPRODeck の card_images（同じカードの別のイラスト）
  ・EDOPro のカードデータ（data/edo-cards.js）で、元のカードと同じ内容の別番号（alias）。番号が近いものだけ（別名のカードは除く）
  ・上の2つで分かった絵違いの番号の「間」の番号（例：1・3 が分かっていれば 2）。YGOPRODeck に画像だけあることがある
    （元の番号のすぐ後ろの番号などは、カードではない画像（スタンプなど）のことが多いので試さない）
画像があるかを確かめ、YGOPRODeck のイラスト画像（切り抜き済み）が無く、EDOPro の画像（カード全体）だけがあるものは
FULL_OK（目で確かめて問題なかったもの）だけを ALT_FULL に入れる（アプリはカード全体の画像からイラストを切り出す）。
EDOPro のカード全体の画像は、新しいカードだと「SAMPLE」の入った宣伝用の画像のことが多いため、確かめていないものは使わない。
BLOCK は、カードの絵ではない画像（「SAMPLE」・ロゴ入り・吹き出しのスタンプ・空の画像など）。
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

# EDOPro のカード全体の画像から切り出してよいもの（2026/10/21 に目で確かめた。SAMPLE・ロゴ・文字の入っていないもの）
FULL_OK = {
    759395, 1861631, 2419597, 3635139, 7894707, 13021683, 17242023, 24203750, 27096834, 27118422, 28331070,
    29053657, 30275299, 30397787, 30752325, 33396950, 33396951, 35809263, 37744404, 37970942, 38033120,
    38817296, 39030884, 46986409, 46986410, 46986411, 46986412, 46986413, 50208445, 54577951, 59242459,
    65302904, 65305469, 65424482, 66247040, 68468461, 71413902, 71564253, 74364661, 74665151, 76504387,
    76636979, 79791696, 82344138, 87758526, 88570004, 89631133, 89631134, 89631135, 89631136, 89631137,
    89631138, 91998122,
}
# オーバーフレーム（イラストがカード全体に広がっている）の絵違い。EDOPro の画像には「SAMPLE」やロゴが下の方に入っているので、
# 枠とその部分を切り捨てて、イラストの上の方だけを出す（2026/10/21 に目で確かめた）
OVER_OK = {
    12908095, 13243125, 14965713, 21522603, 24269962, 29479266, 37458565, 40237840, 41350418, 44001994,
    48393694, 49415282, 53183601, 53481939, 54603526, 54725178, 64866, 65541656, 66664204, 67886896,
    70405002, 75787709, 89875647, 90091225, 90960359, 91714773, 92058903, 92936365, 93871600, 9603253,
}
# カードの絵ではない画像（SAMPLE・ロゴ入り・吹き出しのスタンプ・漫画のコマ・空の画像など）
#（1186448・48171152 はオーバーフレームだが、ロゴがイラストの上の方にかかるので使わない）
BLOCK = {
    1186448, 45627619, 48171152, 97268404, 2347658, 38033130, 65741789, 74677431, 90448282, 81172177, 20250830,
    24224831, 30581602, 13048473, 14898067,
}


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
    edo_ids = set()
    if EDO.exists():
        text = EDO.read_text(encoding="utf-8")
        d = json.loads(text[text.index("{"): text.rindex("}") + 1])["d"]
        edo_ids = {int(k) for k in d}
        for k, v in d.items():
            if not isinstance(v, list) or not v[0]:
                continue
            orig = v[0]
            o = d.get(str(orig))
            if not o or o[1:] != v[1:] or abs(int(k) - orig) >= 100 or orig not in known:
                continue
            alts.setdefault(orig, set()).add(int(k))

    # 分かっている絵違いの番号の「間」の番号を試す
    taken = known | edo_ids
    gaps = {}
    for orig, have in alts.items():
        # 元の番号の近く（100以内）の絵違いだけを使う（遠い番号の絵違いがあると、間が何百万にもなるため）
        near = [i for i in have if 0 < i - orig < 100]
        if not near:
            continue
        for i in range(orig + 1, max(near)):
            if i not in have and i not in taken:
                gaps[i] = orig
    with concurrent.futures.ThreadPoolExecutor(6) as ex:
        for i, ok in ex.map(lambda i: (i, exists(YGO_ART.format(i))), sorted(gaps)):
            if ok:
                alts[gaps[i]].add(i)
    print(f"間の番号を試した数 {len(gaps)}")

    # 画像があるかを確かめる（YGOPRODeck が一覧に載せているものは確かめない）
    check = sorted({i for s in alts.values() for i in s} - ygo_listed)
    full, over, drop = set(), set(), set()

    def probe(i):
        if exists(YGO_ART.format(i)):
            return i, "art"
        if exists(IGNIS_FULL.format(i)):
            return i, "full"
        return i, None

    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for i, kind in ex.map(probe, check):
            if kind == "full" and i in FULL_OK:
                full.add(i)
            elif kind == "full" and i in OVER_OK:
                over.add(i)
            elif kind != "art":
                drop.add(i)   # 画像が無い・確かめていないカード全体の画像
    drop |= BLOCK
    alts = {k: sorted(i for i in s if i not in drop and i < 100000000) for k, s in alts.items()}
    alts = {k: v for k, v in alts.items() if v}

    if len(cards) < 10000 or len(alts) < 100:
        raise SystemExit(f"件数が少なすぎるため中止しました（カード {len(cards)} / 絵違い {len(alts)}）")
    body = ",".join(f"{k}:[{','.join(map(str, alts[k]))}]" for k in sorted(alts))
    js = (
        "// 絵違い（イラスト違い）の画像番号（GitHub Actions が毎日作り直す .github/scripts/build_alt_arts.py。手で書き換えない）\n"
        "// ALT_ARTS：カードの番号 → 絵違いの画像番号の配列（YGOPRODeck の card_images と EDOPro のデータから）\n"
        "// ALT_FULL：イラストの画像が無く、カード全体の画像（EDOPro）からイラストを切り出して表示する番号\n"
        "// ALT_OVER：オーバーフレームの絵違い。カード全体の画像（EDOPro）から、枠と下の方（SAMPLE・ロゴ）を除いたイラストの上の方を出す\n"
        f"const ALT_ARTS = {{{body}}};\n"
        f"const ALT_FULL = [{','.join(map(str, sorted(full)))}];\n"
        f"const ALT_OVER = [{','.join(map(str, sorted(over)))}];\n"
    )
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if old == js:
        print("変更なし")
        return
    OUT.write_text(js, encoding="utf-8")
    print(f"更新しました（絵違いのあるカード {len(alts)}枚・カード全体の画像から切り出す {len(full)}枚・オーバーフレーム {len(over)}枚・使わない画像 {len(drop)}枚）")


if __name__ == "__main__":
    main()
