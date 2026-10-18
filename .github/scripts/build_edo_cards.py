"""自動処理用の EDOPro カードデータ data/edo-cards.js を作り直す（GitHub Actions で毎日実行）。

ProjectIgnis/BabelCDB の cards.cdb と release-*.cdb（発売済みでまだ cards.cdb に入っていないカード）から、
エンジンが使う値だけを抜き出す。カテゴリ番号（setcode）が YGOPro のデータと違うため、エンジンにはこちらを渡す。
d[id] = [alias, setcodes(配列 or 0), type, level, race, attribute, atk, def]
中身が変わったときだけファイルを書き換える。
"""
import json
import pathlib
import sqlite3
import tempfile
import urllib.request

UA = "ygo-practice/0.1 (daily edopro card data; github actions)"
OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "edo-cards.js"
API = "https://api.github.com/repos/ProjectIgnis/BabelCDB/contents/"
RAW = "https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/master/"


def fetch(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def main():
    names = [x["name"] for x in json.loads(fetch(API))]
    names = [n for n in names if n == "cards.cdb" or (n.startswith("release-") and n.endswith(".cdb"))]
    d = {}
    for n in names:
        with tempfile.NamedTemporaryFile(suffix=".cdb", delete=False) as f:
            f.write(fetch(RAW + n))
            path = f.name
        con = sqlite3.connect(path)
        rows = con.execute(
            "select id, alias, setcode & 65535, (setcode >> 16) & 65535, (setcode >> 32) & 65535, (setcode >> 48) & 65535,"
            " type, level, race, attribute, atk, def from datas"
        )
        for (cid, alias, s1, s2, s3, s4, typ, level, race, attr, atk, de) in rows:
            sc = [s for s in (s1, s2, s3, s4) if s]
            d[str(cid)] = [alias, sc if sc else 0, typ, level, race, attr, atk, de]
        con.close()
    if len(d) < 10000:
        raise SystemExit(f"カードが少なすぎます（{len(d)}件）。取得に失敗した可能性があるので書き換えません")
    body = json.dumps({"files": names, "count": len(d), "d": d}, ensure_ascii=False, separators=(",", ":"))
    text = (
        "// 自動処理用：EDOPro のカードデータ（ProjectIgnis/BabelCDB）から、カテゴリ番号などエンジンが使う値だけを抜き出したもの。\n"
        "// GitHub Actions が毎日作り直す（.github/scripts/build_edo_cards.py）。手で書き換えない\n"
        "// d[id] = [alias, setcodes(配列 or 0), type, level, race, attribute, atk, def]\n"
        f"const EDO_CARDS = {body};\n"
    )
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
    if old == text:
        print("変更なし")
        return
    OUT.write_text(text, encoding="utf-8")
    print(f"書き換えました（{len(d)}件）")


if __name__ == "__main__":
    main()
