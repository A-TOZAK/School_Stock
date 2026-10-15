#!/usr/bin/env python3
"""トップページの「学年と教科でさがす」の索引を作る。

各棚のページのカード（data-hay を持つ要素）と、トップのSITE MAP（.drawer nav）を読み、
assets/search-index.json に書き出す。棚にカードを足したら、これを1回まわして push する。

  python3 _build/build_search.py

学年（g）は 1〜6 の数のリスト。中学＝7、高校＝8、学年なし＝[]。
教科（s）は 国語・算数・理科・社会・体育・英語・その他 のリスト。
2026-10-15 GEG旭川の登壇でいただいた声「小学校3年算数のように、サイト全体を検索できるとよい」から。
"""
import json
import re
from pathlib import Path
from urllib.parse import urljoin

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
BASE = "/School_Stock/"
OUT = ROOT / "assets" / "search-index.json"

# 棚ページ → （棚の名前, 決まった教科）。教科が None の棚はカードごとに決める
SHELVES = {
    "prints/sansu/index.html": ("算数プリント（式と言葉）", "算数"),
    "prints/sansu-ensyu/index.html": ("算数プリント（レベル別演習）", "算数"),
    "prints/tsukaeru/index.html": ("つかえるシリーズ", None),
    "prints/kokugo/index.html": ("国語プリント", "国語"),
    "prints/rika/index.html": ("理科プリント", "理科"),
    "prints/shakai/index.html": ("社会プリント", "社会"),
    "prints/taiiku/index.html": ("体育 学習カード", "体育"),
    "prints/english-puzzles/index.html": ("英語のことばパズル", "英語"),
    "prints/kotoba-asobi/index.html": ("ことばあそびプリント", "国語"),
    "prints/atama/index.html": ("あたまのじゅんび運動", "その他"),
}
SUBJ_CODE = {"sansu": "算数", "kokugo": "国語", "rika": "理科", "shakai": "社会", "sugaku": "数学"}
BAND = {
    "g1": [1], "g2": [2], "g3": [3], "g4": [4], "g5": [5], "g6": [6],
    "low": [1, 2], "mid": [3, 4], "high": [5, 6],
    "elementary": [5, 6], "jhs1": [7], "jhs2": [7], "jhs3": [7],
}
# SITE MAP の項目で、リンク先から教科が決まるもの
URL_SUBJ = {
    "prints/kokugo/": "国語", "https://a-tozak.github.io/digital-kokugo-jiten/": "国語",
    "https://a-tozak.github.io/shakai-kotoba-jiten/": "社会", "https://a-tozak.github.io/digital-eigo-jiten/": "英語",
    "tools/eigo-flashcards/": "英語", "gakkyu/alt/": "英語",
}
KANSUJI = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6}


def rel(href, page):
    """カードのリンクを、トップから見たリンクに直す（棚の外のファイル置き場は絶対パスのまま）"""
    u = urljoin(BASE + page, href)
    return u[len(BASE):] if u.startswith(BASE) else u


def grades_from_text(t):
    g = set()
    if re.search(r"中学|中[123]|Junior High", t):
        g.add(7)
    if re.search(r"高校|高等学校", t):
        g.add(8)
    for m in re.finditer(r"(?<!中学)(?<!中)(?<!高)([1-6１-６])年", t):
        g.add(int(m.group(1).translate(str.maketrans("１２３４５６", "123456"))))
    for m in re.finditer(r"小([1-6])", t):
        g.add(int(m.group(1)))
    for m in re.finditer(r"([一二三四五六])年", t):
        g.add(KANSUJI[m.group(1)])
    if "低学年" in t:
        g |= {1, 2}
    if "中学年" in t:
        g |= {3, 4}
    if "高学年" in t:
        g |= {5, 6}
    return sorted(g)


def subj_from_text(t):
    s = []
    for key, name in [("国語", "国語"), ("算数", "算数"), ("理科", "理科"), ("社会", "社会"),
                      ("体育", "体育"), ("英語", "英語"), ("英単語", "英語"), ("数学", "数学")]:
        if key in t and name not in s:
            s.append(name)
    return s


def clean(t):
    return re.sub(r"\s+", " ", t or "").strip()


def cards(page, shelf, subj):
    soup = BeautifulSoup((ROOT / page).read_text(encoding="utf-8"), "html.parser")
    out = []
    for c in soup.select("[data-hay]"):
        a = c.select_one("a.tt") or c.select_one("a[href]")
        if not a or not a.get("href"):
            continue
        hay = clean(c.get("data-hay"))
        title = clean(a.get_text(" "))
        band = c.get("data-band", "")
        g = sorted(set(BAND.get(band, [])) | set(grades_from_text(c.get("data-grade", "") + " " + hay)))
        if 7 in g and any(x <= 6 for x in g) and band.startswith("jhs"):
            g = [7]
        s = subj
        if s is None:
            s = SUBJ_CODE.get(c.get("data-subj", ""), "その他")
        tags = [clean(x.get_text()) for x in c.select(".tag")]
        img = c.select_one(".thumb img")
        out.append({
            "t": title,
            "u": rel(a["href"], page),
            "p": shelf,
            "pu": rel("./", page),
            "g": g,
            "s": [s],
            "k": hay,
            "d": " ".join(x for x in tags if x and x not in title),
            "i": rel(img["src"], page) if img and img.get("src") else "",
        })
    return out


def drawer():
    """トップのSITE MAPから、カードのない棚・道具・読みものを拾う"""
    soup = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "html.parser")
    out, sec = [], ""
    skip_sec = ("ABOUT", "つながる")
    for el in soup.select(".drawer nav > *"):
        if "dr-sec" in (el.get("class") or []):
            sec = clean(el.get_text())
            continue
        if el.name != "a" or sec.startswith(skip_sec):
            continue
        href = el.get("href", "")
        if not href or href.startswith("#") or href == "./":
            continue
        small = el.find("small")
        desc = clean(small.get_text()) if small else ""
        if small:
            small.extract()
        title = clean(el.get_text()).rstrip("↗ ").strip()
        if re.search(r"パスワード|限定", title + desc):
            continue
        t = title + " " + desc
        subj = next((v for k, v in URL_SUBJ.items() if href.startswith(k)), None)
        out.append({
            "t": title, "u": href, "p": sec.split("｜")[-1], "pu": "", "g": grades_from_text(t),
            "s": [subj] if subj else (subj_from_text(title) or subj_from_text(desc)), "k": t, "d": desc, "i": "",
        })
    return out


def extra():
    """カードを持たない棚のうち、学年と教科で引かれたいもの"""
    out = []
    for g in range(1, 7):
        out.append({
            "t": f"ふりかえりプリント {g}年", "u": f"prints/furikaeri/#{g}年", "p": "ふりかえりプリント",
            "pu": "prints/furikaeri/", "g": [g], "s": ["算数", "国語"],
            "k": f"ふりかえりプリント 宿題 毎日 両面 既習 復習 {g}年 算数 国語 読解",
            "d": "表は算数の復習、裏は国語の読解。1か月20枚", "i": "",
        })
    out.append({
        "t": "難問集（4年算数）", "u": "prints/nanmon/", "p": "難問集", "pu": "prints/nanmon/",
        "g": [4], "s": ["算数"], "k": "難問集 4年 算数 考え方 思考", "d": "考え方の型を1まいに1つ", "i": "",
    })
    return out


def main():
    items = []
    for page, (shelf, subj) in SHELVES.items():
        items += cards(page, shelf, subj)
    items += extra()
    seen = {x["u"] for x in items}
    for x in drawer():
        if x["u"] in seen or x["u"] in {SHELF_TOP for SHELF_TOP in (rel("./", p) for p in SHELVES)}:
            continue
        seen.add(x["u"])
        items.append(x)
    OUT.write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by = {}
    for x in items:
        by[x["p"]] = by.get(x["p"], 0) + 1
    print(f"{len(items)} 件 → {OUT.relative_to(ROOT)}（{OUT.stat().st_size // 1024} KB）")
    for k, v in by.items():
        print(f"  {v:4d}  {k}")
    nog = [x["t"] for x in items if not x["g"] and x["p"] not in ("あたまのじゅんび運動", "ことばあそびプリント")]
    print(f"学年なし {len(nog)} 件")


if __name__ == "__main__":
    main()
