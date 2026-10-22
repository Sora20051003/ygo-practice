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
import io
import json
import pathlib
import urllib.error
import urllib.request
import zipfile

UA = "ygo-practice/0.1 (daily alt art table; github actions)"
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "alt-arts.js"
EDO = ROOT / "data" / "edo-cards.js"
YGO_ART = "https://images.ygoprodeck.com/images/cards_cropped/{}.jpg"
IGNIS_FULL = "https://pics.projectignis.org:2096/pics/{}.jpg"

# EDOPro のカード全体の画像から、ふつうの枠のイラストの部分を切り出してよいもの（2026/10/21 に目で確かめた。SAMPLE・ロゴの入っていない、ふつうの枠のもの）
FULL_OK = {
    759395, 1861631, 33396950, 33396951, 35809263, 37744404, 37970942, 38033120, 46986409, 46986410,
    46986411, 46986412, 46986413, 59242459, 65305469, 68468461, 71413902, 71564253, 74364661, 89631133,
    89631134, 89631135, 89631136, 89631137, 89631138, 91998122,
}
# オーバーフレーム（イラストがカード全体に広がっている）の絵違い。絵違いとして出さない（2026/10/21 に目で確かめた）
OVERFRAME = {
    12908095, 13243125, 14965713, 21522603, 24269962, 29479266, 37458565, 40237840, 41350418, 44001994,
    48393694, 49415282, 53183601, 53481939, 54603526, 54725178, 64866, 65541656, 66664204, 67886896,
    70405002, 75787709, 89875647, 90091225, 90960359, 91714773, 92058903, 92936365, 93871600, 9603253,
    2419597, 3635139, 7894707, 13021683, 17242023, 24203750, 27096834, 27118422, 28331070, 29053657,
    30275299, 30397787, 30752325, 38817296, 39030884, 50208445, 54577951, 65302904, 65424482, 66247040,
    74665151, 76504387, 76636979, 79791696, 82344138, 87758526, 88570004,
    1186448, 48171152,
}
# 番号の近くを試して見つけた絵違い（YGOPRODeck の一覧には載っていないが、イラストの画像がある）。2026/10/22 に目で確かめたもの
# （吹き出しの文字が入ったスタンプ・白黒の漫画のコマなど、カードの絵ではないものは入れない）
PROBED_OK = {
    23434538: [23434539],   # 増殖するG（マスターデュエルのスタンプの絵。使う人の希望で入れる）
    50755: [50756],
    102380: [102382],
    1525329: [1525330],
    3643300: [3643302],
    4376658: [4376659],
    5405694: [5405695, 5405696],
    6368038: [6368041],
    8198621: [8198623],
    9012916: [9012917],
    9396662: [9396663],
    9726840: [9726841],
    10000090: [10000091],
    10443957: [10443958],
    11654067: [11654068],
    12541409: [12541410],
    12863633: [12863634],
    13582837: [13582838],
    13764602: [13764603],
    14318794: [14318795],
    15025844: [15025846],
    16178681: [16178682, 16178683, 16178684],
    16475472: [16475473],
    17000165: [17000166],
    17484499: [17484501],
    20366274: [20366275],
    23995346: [23995347, 23995348, 23995349, 23995350],
    24094653: [24094656, 24094657],
    24311372: [24311374],
    24874631: [24874633],
    25551951: [25551952],
    27911549: [27911550],
    28546905: [28546907],
    29228529: [29228530],
    31122090: [31122093],
    31709826: [31709828],
    31764353: [31764354],
    32056070: [32056071],
    34690953: [34690954],
    36045450: [36045451],
    36280194: [36280195],
    38033121: [38033131],
    39507162: [39507164],
    40410110: [40410111],
    40619825: [40619826],
    40633084: [40633085],
    40640057: [40640060, 40640061],
    41456841: [41456842],
    43892408: [43892409],
    44095762: [44095764],
    44459942: [44459943],
    44508094: [44508097],
    45231177: [45231178],
    46303688: [46303689],
    46986414: [36996508, 46986415, 46986416, 46986418, 46986419, 46986420, 46986421, 46986422, 46986423, 46986424, 46986425],
    49752795: [49752796],
    51976476: [51976477],
    54704216: [54704217],
    57160136: [57160137],
    57312333: [57312334],
    58621589: [58621590],
    62015408: [62015409],
    62210247: [62210248],
    62481203: [62481204],
    65515667: [65515668],
    66331855: [66331856],
    66602787: [66602789],
    69140098: [69140100],
    70781052: [70781056],
    70828912: [70828913],
    70865988: [70865989],
    71272951: [71272952],
    73580471: [73580473],
    73639099: [73639100],
    74677422: [74677423, 74677424, 74677425, 74677426, 74677427, 74677430, 74677433],
    76524506: [76524507],
    76812113: [76812115],
    76922029: [76922030],
    77414722: [77414723],
    77585513: [77585516],
    77672444: [77672445],
    78371393: [78371394],
    78394032: [78394033],
    78783370: [78783371],
    78789356: [78789357],
    80101899: [80101901],
    80193355: [80193356],
    85106525: [85106526],
    85602018: [85602019],
    86120751: [86120752],
    87240371: [87240372],
    87796900: [87796902],
    88819587: [88819589],
    89631139: [89631149, 89631150],
    91512836: [91512838],
    94119974: [94119976],
    98338152: [98338153],
    99092624: [99092625],
}
# カードの絵ではない画像（SAMPLE・ロゴ入り・吹き出しのスタンプ・漫画のコマ・空の画像など）
BLOCK = {
    45627619, 97268404, 2347658, 38033130, 65741789, 74677431, 90448282, 81172177, 20250830,
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


# カードデータ（ygocdb）の番号で YGOPRODeck に画像が無いカード（発売前の仮の番号のままのカードなど）：
# KONAMI のカード番号（cid ＝ YGOPRODeck の konami_id）が同じ YGOPRODeck のカードの番号を、画像の番号として使う
def image_ids(cards, known):
    by_konami = {}
    for c in cards:
        for m in c.get("misc_info") or []:
            k = m.get("konami_id")
            if isinstance(k, int) and k:
                by_konami[k] = c["id"]
    try:
        req = urllib.request.Request("https://ygocdb.com/api/v0/cards.zip", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=180) as r:
            z = zipfile.ZipFile(io.BytesIO(r.read()))
        data = json.loads(z.read(z.namelist()[0]))
    except Exception as e:
        print(f"カードデータ（ygocdb）を読めませんでした：{e}")
        return {}
    out = {}
    for e in data.values():
        i, cid = e.get("id"), e.get("cid")
        if isinstance(i, int) and i not in known and cid in by_konami and by_konami[cid] != i:
            out[i] = by_konami[cid]
    print(f"画像の番号を置き換えるカード {len(out)}枚")
    return out


def main():
    req = urllib.request.Request("https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        cards = json.load(r)["data"]
    known = {c["id"] for c in cards}
    img_ids = image_ids(cards, known)
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

    # 前に番号の近くを試して見つけ、目で確かめた絵違い
    for orig, extra in PROBED_OK.items():
        alts.setdefault(orig, set()).update(extra)

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
    full, drop = set(), set()

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
            elif kind != "art":
                drop.add(i)   # 画像が無い・確かめていないカード全体の画像
    drop |= BLOCK | OVERFRAME
    alts = {k: sorted(i for i in s if i not in drop and i < 100000000) for k, s in alts.items()}
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
        "// IMG_IDS：カードの番号 → 画像の番号（発売前の仮の番号のままのカードなど。KONAMI のカード番号で YGOPRODeck のカードと対応させる）\n"
        f"const IMG_IDS = {{{','.join(f'{k}:{v}' for k, v in sorted(img_ids.items()))}}};\n"
    )
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if old == js:
        print("変更なし")
        return
    OUT.write_text(js, encoding="utf-8")
    print(f"更新しました（絵違いのあるカード {len(alts)}枚・カード全体の画像から切り出す {len(full)}枚・使わない画像 {len(drop)}枚）")


if __name__ == "__main__":
    main()
