"""カードの発売日の対応表 data/release-dates.js を作り直す（GitHub Actions で毎日実行）。

  OCG          : YGOPRODeck の misc_info.ocg_date（OCGでの初登場日）
  マスターデュエル: Master Duel Meta の release（実装日）

KONAMI のカード番号（cid）→ 日付（YYYYMMDD の数値）。中身が変わったときだけファイルを書き換える。
tools/build-release-dates.ps1（手元のパソコン用）と同じ内容を作る。
"""
import datetime
import json
import pathlib
import re
import time
import urllib.request

UA = "ygo-practice/0.1 (daily release date table; github actions)"
OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "release-dates.js"


def get_json(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def to_num(d):
    return int(re.sub(r"[^0-9]", "", d)[:8])


def main():
    print("[1/3] YGOPRODeck から OCG の発売日を取得")
    ocg, name_to_cid = {}, {}
    for c in get_json("https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes")["data"]:
        m = (c.get("misc_info") or [{}])[0]
        cid = m.get("konami_id")
        if not isinstance(cid, int) or cid <= 0:   # まれに不正な番号がある
            continue
        name_to_cid[c["name"]] = cid
        if m.get("ocg_date"):
            ocg[cid] = to_num(m["ocg_date"])
    print(f"  OCG: {len(ocg)}枚")

    print("[2/3] Master Duel Meta からマスターデュエルの実装日を取得")
    md = {}
    for page in range(1, 31):
        time.sleep(0.8)
        cards = get_json(f"https://www.masterduelmeta.com/api/v1/cards?limit=2000&page={page}")
        if not cards:
            break
        for c in cards:
            cid = name_to_cid.get(c.get("name"))
            if not cid or not c.get("release"):
                continue
            d = to_num(c["release"])
            if cid not in md or d < md[cid]:
                md[cid] = d
        print(f"  {page}ページ目: 累計{len(md)}枚")

    # 取得に失敗して極端に少ないときは上書きしない（壊れたデータを公開しないため）
    if len(ocg) < 10000 or len(md) < 10000:
        raise SystemExit(f"件数が少なすぎるため中止しました（OCG {len(ocg)} / MD {len(md)}）")

    body = lambda h: ",".join(f"{k}:{h[k]}" for k in sorted(h, key=str))
    data_part = f"ocg:{{{body(ocg)}}},md:{{{body(md)}}}"
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if data_part in old:
        print("[3/3] 変更なし")
        return
    js = (
        "// カードの発売日（tools/build-release-dates.ps1 / GitHub Actions で自動作成。手で書き換えない）\n"
        "// KONAMIのカード番号 → 日付（YYYYMMDD）。OCG: YGOPRODeck / マスターデュエル: Master Duel Meta\n"
        f"const RELEASE_DATES = {{generated:'{datetime.date.today().isoformat()}',{data_part}}};\n"
    )
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(js, encoding="utf-8")
    print(f"[3/3] 更新しました（OCG {len(ocg)}枚・MD {len(md)}枚）")


if __name__ == "__main__":
    main()
