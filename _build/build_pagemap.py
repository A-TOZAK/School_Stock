#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
School Stock ページ名の対応表を作る
- サイト内の *.html をぜんぶ読み、<title> から「ページの名前」を取り出す。
- 集計ページ（/stats/）は、貯まっている住所（pv:/School_Stock/...）を
  この表で名前に置きかえて表示する。表がないと住所のまま並んで読めない。
- 使い方: python3 _build/build_pagemap.py
  → stats/pagemap.json を書き出す（コミットする）
"""
import json, re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "/School_Stock/"            # GitHub Pages での置き場所
OUT = ROOT / "stats" / "pagemap.json"

# 読まないところ（配布物の中身・素材フォルダ・作業用）
SKIP_DIRS = {".git", "_build", "_setup", "assets", "node_modules"}
# 棚のページではないもの（配布ファイル本体・部品）
SKIP_PARTS = {"download", "img", "thumbs", "thumb", "fonts", "icons", "packs"}

TAIL = re.compile(r"\s*(?:──|—|\||｜|-)\s*School\s*Stock\s*$", re.I)
SPLIT = re.compile(r"\s*(?:──|｜|\|)\s*")


def title_of(path: Path) -> str:
    """<title> を取り出して、末尾の「｜School Stock」を落とす"""
    try:
        html = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    if not m:
        return ""
    t = re.sub(r"\s+", " ", m.group(1)).strip()
    t = TAIL.sub("", t).strip()
    return t


def short(t: str) -> str:
    """棚の名前は、区切りより前の短いほうを使う（例:「教材研究ノート ── こう考えたら…」→「教材研究ノート」）"""
    return SPLIT.split(t)[0].strip() if t else ""


def url_of(path: Path) -> str:
    """counter.js が貯める住所と同じ形にそろえる（index.html は落とす）"""
    rel = path.relative_to(ROOT).as_posix()
    if rel.endswith("index.html"):
        rel = rel[: -len("index.html")]
    return BASE + rel


def wanted(path: Path) -> bool:
    parts = path.relative_to(ROOT).parts[:-1]
    if any(p in SKIP_DIRS or p.startswith(".") for p in parts):
        return False
    if any(p in SKIP_PARTS for p in parts):
        return False
    return True


def main() -> None:
    pages, sections = {}, {}

    for path in sorted(ROOT.rglob("*.html")):
        if not wanted(path):
            continue
        t = title_of(path)
        if not t:
            continue
        rel = path.relative_to(ROOT)
        sec = rel.parts[0] if len(rel.parts) > 1 else ""
        pages[url_of(path)] = {"t": t, "s": sec}
        # 棚の名前は、その棚の index.html の題から取る（増えても手直しがいらない）
        if rel.name == "index.html" and len(rel.parts) == 2:
            sections[sec] = short(t)

    sections[""] = "棚トップ"
    # index.html を持たない棚（例: r/fp）は、フォルダ名をそのまま出す
    for meta in pages.values():
        sections.setdefault(meta["s"], meta["s"] or "棚トップ")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {"generated": date.today().isoformat(), "sections": sections, "pages": pages},
            ensure_ascii=False, indent=1, sort_keys=True,
        ) + "\n",
        encoding="utf-8",
    )
    print(f"{OUT.relative_to(ROOT)}: ページ {len(pages)}件 / 棚 {len(sections)}件")


if __name__ == "__main__":
    main()
