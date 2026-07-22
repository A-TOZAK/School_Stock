#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
School Stock 国語プリント棚 サムネイル生成
- prints/kokugo/{yomu,kotoba,sakubun,kikitori}/*.pdf の1ページ目を読み、
  「分類バッジ＋学年＋題名＋紙面ミニチュア」のカード型サムネを thumb/ に書き出す。
- 使い方: python3 _build/build_thumbs.py
"""
import re, sys
from pathlib import Path
import fitz
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
KOKUGO = ROOT / "prints" / "kokugo"
THUMB = KOKUGO / "thumb"
FONTDIR = Path.home() / "Library/Fonts/MorisawaFonts"
F_BOLD = FONTDIR / "A-OTF-UDShinGoPro-Bold.otf"
F_MED = FONTDIR / "A-OTF-UDShinGoPro-Medium.otf"

# 出力サイズ（CSSは aspect-ratio 4/3 表示・2倍解像度で書き出す）
W, H = 880, 700
PAD = 40

INK = (21, 24, 28)
SUB = (107, 112, 119)
LINE = (230, 230, 227)
PAPER = (255, 255, 255)
WASH = (246, 246, 244)

# 分類の色（紙・墨・藍/老緑の系統でそろえる。teal緑は使わない）
TYPE_COLOR = {
    "説明文": (43, 95, 217),        # 藍
    "物語文": (63, 107, 83),        # 老緑
    "要約": (178, 106, 43),         # 墨橙
    "詩": (107, 90, 166),           # 藤
    "情報の読み取り": (47, 72, 88),  # 鉄紺
    "語句": (163, 74, 82),          # 臙脂
    "かなづかい": (163, 74, 82),
    "かたかな": (163, 74, 82),
    "つなぎ言葉": (163, 74, 82),
    "ことわざ": (163, 74, 82),
    "敬語": (163, 74, 82),
    "熟語": (163, 74, 82),
    "条件作文": (150, 88, 60),       # 焦茶
    "先生の話": (47, 72, 88),
    "おしらせ": (47, 72, 88),
    "でんごん": (47, 72, 88),
    "せつめい": (47, 72, 88),
    "説明": (47, 72, 88),
    "おはなし": (63, 107, 83),
    "はたらく人": (63, 107, 83),
    "校内放送": (47, 72, 88),
    "講話": (47, 72, 88),
}
DEFAULT_COLOR = (90, 95, 102)

KOTOBA_TYPE = {
    "1年_No01_はをへのつかいかた": "かなづかい",
    "2年_No01_かたかなで書くことば": "かたかな",
    "3年_No01_気持ちを表す言葉": "語句",
    "3年_No02_つなぎ言葉": "つなぎ言葉",
    "4年_No01_ことわざ生きもの": "ことわざ",
    "5年_No01_敬語尊敬語": "敬語",
    "6年_No01_熟語の成り立ち": "熟語",
}


def font(path, size):
    return ImageFont.truetype(str(path), size)


def parse(cat, stem):
    """(grade, type, title) を返す"""
    if cat == "kikitori":
        m = re.match(r"小(\d)_No(\d+)_([^_]+)_(.+)", stem)
        return f"{m.group(1)}年", m.group(3), m.group(4)
    if cat == "yomu":
        m = re.match(r"(\d年|中学年|高学年)_No(\d+)_([^_]+)_(.+)", stem)
        return m.group(1), m.group(3), m.group(4)
    if cat == "kotoba":
        m = re.match(r"([^_]+)_No(\d+)_語句_(.+)", stem)
        if m:
            return m.group(1), "語句", m.group(3)
        m = re.match(r"([^_]+)_No(\d+)_(.+)", stem)
        return m.group(1), KOTOBA_TYPE.get(stem, "語句"), m.group(3)
    m = re.match(r"No(\d+)_(.+)", stem)
    return "高学年", "条件作文", m.group(2)


def render_page(pdf, target_w):
    """PDF1ページ目を幅target_wでレンダーしてPIL画像で返す"""
    doc = fitz.open(pdf)
    page = doc[0]
    zoom = target_w / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    doc.close()
    return img


def fit_title(draw, text, fnt_path, max_w, start=44, min_size=26):
    """1行で収まるフォントサイズを返す（無理なら最小サイズ＋末尾省略）"""
    size = start
    while size > min_size:
        f = font(fnt_path, size)
        if draw.textlength(text, font=f) <= max_w:
            return f, text
        size -= 2
    f = font(fnt_path, min_size)
    t = text
    while t and draw.textlength(t + "…", font=f) > max_w:
        t = t[:-1]
    return f, (t + "…" if t != text else text)


def build_card(pdf, grade, typ, title, out):
    color = TYPE_COLOR.get(typ, DEFAULT_COLOR)
    card = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(card)

    # 外枠
    d.rectangle([0, 0, W - 1, H - 1], outline=LINE, width=2)
    # 上の分類色帯
    d.rectangle([0, 0, W, 12], fill=color)

    y = 12 + 22

    # 分類バッジ
    fb = font(F_BOLD, 23)
    bw = d.textlength(typ, font=fb)
    d.rectangle([PAD, y, PAD + bw + 28, y + 42], fill=color)
    d.text((PAD + 14, y + 21), typ, font=fb, fill=(255, 255, 255), anchor="lm")

    # 学年（右寄せ）
    fg = font(F_BOLD, 25)
    d.text((W - PAD, y + 21), grade, font=fg, fill=SUB, anchor="rm")

    # 題名
    y += 42 + 14
    ft, t = fit_title(d, title, F_BOLD, W - PAD * 2, start=40, min_size=24)
    d.text((PAD, y), t, font=ft, fill=INK, anchor="lt")

    # 紙面ミニチュア
    top = 148
    box_w = W - PAD * 2
    box_h = H - top - 24
    page = render_page(pdf, box_w * 2)
    scale = min(box_w / page.width, box_h / page.height)
    nw, nh = int(page.width * scale), int(page.height * scale)
    page = page.resize((nw, nh), Image.LANCZOS)
    px = (W - nw) // 2
    d.rectangle([px - 1, top - 1, px + nw, top + nh], fill=WASH, outline=LINE, width=1)
    card.paste(page, (px, top))
    d.rectangle([px - 1, top - 1, px + nw, top + nh], outline=LINE, width=2)

    card.save(out, "WEBP", quality=86, method=6)


def main():
    only = sys.argv[1:] or ["yomu", "kotoba", "sakubun", "kikitori"]
    THUMB.mkdir(exist_ok=True)
    n = 0
    for cat in only:
        for pdf in sorted((KOKUGO / cat).glob("*.pdf")):
            grade, typ, title = parse(cat, pdf.stem)
            build_card(pdf, grade, typ, title, THUMB / f"{pdf.stem}.webp")
            n += 1
            if n % 20 == 0:
                print(f"  ... {n}枚")
    print(f"完成: {n}枚 → {THUMB}")


if __name__ == "__main__":
    main()
