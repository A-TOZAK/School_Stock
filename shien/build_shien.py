#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
School Stock 支援カード棚ビルダー
支援カード集プロジェクト（04_エビデンス版・06_話型集）から、掲示カード・机上ミニ・
先生用・話型のPDFとサムネイルを shien/ に取り込み、一覧ページ index.html を生成する。
枚数は cards12.json / wakei.json から自動で拾う（2026-07-07現在：掲示43・ミニ11・話型6・先生用3）。
使い方: python3 shien/build_shien.py
"""
import json, re, shutil, subprocess, html
from pathlib import Path

SITE = Path(__file__).resolve().parent          # .../School_Stock/shien
PROJ = Path.home() / "Claude" / "Projects" / "🃏-支援カード集"
SRC04 = PROJ / "04_エビデンス版"
SRC06 = PROJ / "06_話型集"
PDFDIR = SITE / "pdf"; THUMB = SITE / "thumb"
PDFDIR.mkdir(exist_ok=True); THUMB.mkdir(exist_ok=True)

CARDS = json.loads((SRC04 / "cards12.json").read_text(encoding="utf-8"))
WAKEI = json.loads((SRC06 / "wakei.json").read_text(encoding="utf-8"))
CATS = CARDS["categories"]
REFERENCES = CARDS.get("references", {})

def plain(s):
    """ルビ《》・空白を除いた素の文字列"""
    return re.sub(r"《[^》]*》", "", s).replace("｜", "").replace("　", " ").strip()

def plain_steps(steps):
    """掲示カードの手順を素テキストのリストに。書き込み欄はラベル or （書きこみ）"""
    out = []
    for s in steps:
        if isinstance(s, dict):
            w = plain(s.get("w") or "")
            out.append(w if w else "（じぶんで 書きこむ）")
        else:
            out.append(plain(s))
    return out

def modal_steps(c):
    """モーダルに出す手順。wordlist型は ことば（意味） の一覧、word1型（1枚1概念）は いみ・れい にする"""
    if "words" in c:
        return [f'{plain(w["w"])}（{plain(w["m"])}）' for w in c["words"]]
    if "imi" in c:
        return [f'いみ：{plain(c["imi"])}', f'れい：{plain(c["rei"])}']
    return plain_steps(c["steps"])

def slug(s):
    """ファイル名用：ルビ除去・空白と記号を整理"""
    s = plain(s).replace(" ", "").replace("？", "").replace("?", "")
    return s

def copy_pdf(src, dest_name):
    dest = PDFDIR / dest_name
    shutil.copy2(src, dest)
    return dest.name

def make_thumb(src_png, out_name, width=520):
    out = THUMB / out_name
    shutil.copy2(src_png, out)
    subprocess.run(["sips", "-Z", str(width), str(out)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out.name

# ---------- 収集：(section, items[]) を作る ----------
# item = dict(id, title, sub, tag, tagcolor, pdf, thumb)
sections = []

# 1) 掲示カード（カテゴリ別）
by_cat = {}
for c in CARDS["cards"]:
    by_cat.setdefault(c["cat"], []).append(c)
for ck, cv in CATS.items():
    items = []
    for c in by_cat.get(ck, []):
        cid = c["id"]
        name = plain(c["name"])
        pdf = copy_pdf(SRC04 / "pdf" / f"{cid}.pdf", f"{cid}_{slug(c['name'])}.pdf")
        th = make_thumb(SRC04 / "png" / f"{cid}.png", f"{cid}.png")
        badge = plain(CARDS["badges"].get(c["badge"], "")) if c.get("badge") else ""
        items.append(dict(id=cid, title=name, sub=plain(c["aikotoba"]),
                          tag=cv["label"], tagcolor=cv["color"], pdf=pdf, thumb=th,
                          modal=True, aikotoba=plain(c["aikotoba"]),
                          steps=modal_steps(c), badge=badge,
                          bamen=c.get("bamen", ""), naze=c.get("naze", ""),
                          refs=c.get("refs", [])))
    sections.append(dict(key=f"cat-{ck}", head=cv["label"], en=cv["sub"],
                         color=cv["color"], items=items))

# 2) 机上ミニ版
mini_items = []
mini_label = {"_howto": "つかいかた", "_jibun": "じぶんのカード",
              "_t0": "たすけてください", "_t1": "ヒントをください",
              "_t2": "じかんをください", "_t3": "ここまでできました"}
for ms in CARDS["mini_sheets"]:
    f = ms["file"]  # ミニ01..06
    contents = "・".join(
        mini_label.get(i, plain(next((c["name"] for c in CARDS["cards"] if c["id"] == i), i)).replace("カード", ""))
        for i in ms["ids"])
    pdf = copy_pdf(SRC04 / "pdf" / f"{f}.pdf", f"{f}_机上ミニ版.pdf")
    th = make_thumb(SRC04 / "png" / f"{f}.png", f"{f}.png")
    mini_items.append(dict(id=f, title=f"机上ミニ版　{f[-2:]}", sub=contents,
                           tag="机上ミニ（A6×4面）", tagcolor="#5b616b", pdf=pdf, thumb=th))
sections.append(dict(key="mini", head="机上ミニ版", en="切って机の上に・テスト中OKバッジつき",
                     color="#5b616b", items=mini_items))

# 3) 話型シート
wakei_items = []
for s in WAKEI["sheets"]:
    wid = s["id"]
    pdf = copy_pdf(SRC06 / "pdf" / f"{wid}.pdf", f"{wid}_{slug(s['title'])}.pdf")
    th = make_thumb(SRC06 / "png" / f"{wid}.png", f"{wid}.png")
    wakei_items.append(dict(id=wid, title=plain(s["title"]), sub=plain(s["sub"]),
                            tag="話型シート", tagcolor=s["accent"], pdf=pdf, thumb=th))
sections.append(dict(key="wakei", head="話型シート", en="考えの書き方・話し方・つなぎ方（わけを言う型つき）",
                     color="#2b5fd9", items=wakei_items))

# 4) 先生用シート
teach_items = []
for mark, ascii_no, label in [("①", "1", "よみとり・かかわり"),
                               ("②", "2", "とりかかり・まなびかた"),
                               ("③", "3", "せいかつ"),
                               ("④", "4", "がくしゅうのことば")]:
    pdf = copy_pdf(SRC04 / "pdf" / f"先生用{mark}.pdf", f"先生用{ascii_no}_使い方.pdf")
    th = make_thumb(SRC04 / "png" / f"先生用{mark}.png", f"先生用{ascii_no}.png")
    teach_items.append(dict(id=f"T{ascii_no}", title=f"先生用シート　{mark}", sub=label,
                            tag="先生向け", tagcolor="#333", pdf=pdf, thumb=th))
sections.append(dict(key="teacher", head="先生用シート", en="使う場・根拠の一覧（先生向け）",
                     color="#333", items=teach_items))

total = sum(len(s["items"]) for s in sections)

# ---------- HTML ----------
E = html.escape
DL_SVG = ('<svg viewBox="0 0 17 17" fill="none" aria-hidden="true"><path d="M8.5 2v8m0 0L5 6.7'
          'M8.5 10l3.5-3.3M2.5 13.5h12" stroke="currentColor" stroke-width="2" '
          'stroke-linecap="round" stroke-linejoin="round"/></svg>')

def card_html(it):
    if it.get("modal"):
        return (
          f'<div class="pc">'
          f'<button class="th th-btn" data-modal="{E(it["id"])}" aria-label="{E(it["title"])}の解説をひらく">'
          f'<div class="thumb"><img loading="lazy" src="thumb/{E(it["thumb"])}" alt="{E(it["title"])}"></div></button>'
          f'<div class="pm">'
          f'<span class="ptag" style="--tc:{it["tagcolor"]}">{E(it["tag"])}</span>'
          f'<h3>{E(it["title"])}</h3>'
          f'<p class="ai">{E(it["sub"])}</p>'
          f'<div class="pacts">'
          f'<button class="dl kaisetsu" data-modal="{E(it["id"])}">解説を見る</button>'
          f'<a class="dl ghost" href="pdf/{E(it["pdf"])}" target="_blank" rel="noopener">{DL_SVG}PDF</a>'
          f'</div></div></div>')
    return (
      f'<div class="pc">'
      f'<a class="th" href="pdf/{E(it["pdf"])}" target="_blank" rel="noopener">'
      f'<div class="thumb"><img loading="lazy" src="thumb/{E(it["thumb"])}" alt="{E(it["title"])}"></div></a>'
      f'<div class="pm">'
      f'<span class="ptag" style="--tc:{it["tagcolor"]}">{E(it["tag"])}</span>'
      f'<h3>{E(it["title"])}</h3>'
      f'<p class="ai">{E(it["sub"])}</p>'
      f'<a class="dl" href="pdf/{E(it["pdf"])}" target="_blank" rel="noopener">{DL_SVG}PDF</a>'
      f'</div></div>')

def ref_links(keys):
    """参照キー配列 → <a>リンクのHTML（実在URLのみ・REFERENCESに無いキーは黙って除外）"""
    items = []
    for k in keys:
        r = REFERENCES.get(k)
        if not r:
            continue
        label, url = r
        items.append(f'<li><a href="{E(url)}" target="_blank" rel="noopener">{E(label)}<span class="ext"> ↗</span></a></li>')
    return "".join(items)

def modal_html(it):
    steps = "".join(f'<li>{E(s)}</li>' for s in it["steps"])
    badge = f'<span class="m-badge">{E(it["badge"])}</span>' if it.get("badge") else ""
    refs = ref_links(it.get("refs", []))
    refs_block = (f'<div class="m-refs"><span class="m-lbl">参考にした研究</span><ul>{refs}</ul>'
                  f'<p class="m-refnote">研究の知見をかみくだいて要約したものです。くわしくは各リンク先の原典を参照。</p></div>') if refs else ""
    return (
      f'<div class="modal" id="m-{E(it["id"])}" role="dialog" aria-modal="true" aria-label="{E(it["title"])}">'
      f'<div class="m-card" style="--tc:{it["tagcolor"]}">'
      f'<button class="m-close" data-close aria-label="閉じる">×</button>'
      f'<div class="m-head">'
      f'<div class="m-tags"><span class="m-tag">{E(it["tag"])}</span>{badge}</div>'
      f'<h3>{E(it["title"])}</h3>'
      f'<p class="m-ai">{E(it["aikotoba"])}</p></div>'
      f'<div class="m-body">'
      f'<ol class="m-steps">{steps}</ol>'
      f'<div class="m-block"><span class="m-lbl">こんなときに使う</span><p>{E(it["bamen"])}</p></div>'
      f'<div class="m-block"><span class="m-lbl">なぜ効くのか</span><p>{E(it["naze"])}</p></div>'
      f'{refs_block}'
      f'<a class="m-dl" href="pdf/{E(it["pdf"])}" target="_blank" rel="noopener">{DL_SVG}カードのPDFをひらく</a>'
      f'<p class="m-note">カードは「配って終わり」では効きません。先生が一度いっしょにやってみせてから手渡し、できたら認める——その手続きとセットで使ってください。</p>'
      f'</div></div></div>')

def section_html(sec):
    cards = "".join(card_html(it) for it in sec["items"])
    return (
      f'<section data-sec id="sec-{sec["key"]}">'
      f'<div class="sh"><span class="sbar" style="background:{sec["color"]}"></span>'
      f'<h2>{E(sec["head"])}</h2><span class="sen">{E(sec["en"])}</span>'
      f'<span class="scount">{len(sec["items"])}</span></div>'
      f'<div class="grid">{cards}</div></section>')

STYLE = """
:root { --ink:#15181c; --sub:#767b83; --accent:#2b5fd9; --paper:#fff; --wash:#f6f6f4; --line:#e6e6e3; --black:#0e0f11; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic Medium",sans-serif; background:var(--paper); color:var(--ink); line-height:1.9; letter-spacing:.02em; -webkit-font-smoothing:antialiased; }
a { color:var(--accent); text-decoration:none; }
.topbar { background:var(--black); color:#fff; position:sticky; top:0; z-index:40; }
.topbar-in { max-width:1040px; margin:0 auto; padding:13px 24px; display:flex; justify-content:space-between; align-items:center; gap:14px; }
.wordmark { font-size:12.5px; font-weight:700; letter-spacing:.28em; color:#fff; white-space:nowrap; }
.nav { display:flex; gap:18px; align-items:center; }
.nav a { color:#b9bcc2; font-size:11.5px; letter-spacing:.1em; white-space:nowrap; }
.nav a:hover { color:#fff; }
@media (max-width:760px){ .nav { display:none; } }
.menu-btn { display:inline-flex; align-items:center; gap:7px; font-family:inherit; font-size:11.5px; font-weight:700; letter-spacing:.14em; color:#fff; background:none; border:1px solid #4a4e55; padding:6px 12px; cursor:pointer; }
.drawer { position:fixed; top:0; right:0; bottom:0; width:min(320px,86vw); background:var(--paper); border-left:1px solid var(--ink); z-index:60; transform:translateX(102%); transition:transform .22s ease; overflow-y:auto; }
.drawer.open { transform:none; }
.drawer-head { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--ink); }
.drawer-head b { font-size:12px; letter-spacing:.22em; }
.drawer-close { font-family:inherit; background:none; border:none; font-size:20px; cursor:pointer; color:var(--ink); line-height:1; }
.drawer nav { padding:10px 0 30px; }
.dr-sec { padding:14px 20px 4px; font-size:10.5px; font-weight:700; letter-spacing:.2em; color:var(--sub); }
.drawer nav a { display:block; padding:9px 20px; font-size:14px; font-weight:700; color:var(--ink); border-bottom:1px solid var(--wash); }
.drawer nav a small { display:block; font-size:11px; font-weight:400; color:var(--sub); letter-spacing:.04em; }
.drawer nav a.sub2 { padding-left:34px; font-weight:400; font-size:13px; }
.drawer nav a:hover { background:var(--wash); }
.scrim { position:fixed; inset:0; background:rgba(14,15,17,.4); z-index:50; opacity:0; pointer-events:none; transition:opacity .22s; }
.scrim.show { opacity:1; pointer-events:auto; }
.container { max-width:1040px; margin:0 auto; padding:0 24px 72px; }
.head { border-bottom:1px solid var(--ink); padding:34px 0 24px; margin-bottom:8px; }
.kicker { display:inline-block; font-size:11.5px; font-weight:700; letter-spacing:.2em; color:#fff; background:var(--black); padding:4px 12px; margin-bottom:16px; }
.head h1 { font-size:clamp(24px,4vw,34px); font-weight:700; line-height:1.4; margin-bottom:12px; }
.head .lead { font-size:14.5px; color:#3d4148; line-height:1.85; max-width:660px; }
.head .meta { margin-top:14px; font-size:12.5px; color:var(--sub); }
.head .meta b { color:var(--ink); }
.note-use { margin:18px 0 4px; background:var(--wash); border-left:3px solid var(--accent); padding:12px 18px; font-size:13px; line-height:1.8; color:#3d4148; }
.sh { display:flex; align-items:center; gap:12px; margin:36px 0 16px; }
.sh .sbar { width:5px; height:22px; border-radius:2px; }
.sh h2 { font-size:19px; font-weight:700; }
.sh .sen { font-size:12px; color:var(--sub); }
.sh .scount { margin-left:auto; font-family:Georgia,serif; font-style:italic; font-weight:700; color:var(--sub); font-size:15px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:20px; }
.pc { border:1px solid var(--ink); display:flex; flex-direction:column; transition:box-shadow .15s; background:#fff; }
.pc:hover { box-shadow:4px 4px 0 var(--ink); }
.th { display:block; }
.thumb { aspect-ratio:210/297; background:var(--wash); border-bottom:1px solid var(--ink); overflow:hidden; }
.thumb img { width:100%; height:100%; object-fit:cover; object-position:top center; display:block; }
.pm { padding:12px 14px 14px; display:flex; flex-direction:column; gap:6px; flex:1; }
.ptag { align-self:flex-start; font-size:9.5px; font-weight:700; letter-spacing:.1em; color:#fff; background:var(--tc); padding:2px 8px; }
.pm h3 { font-size:14.5px; font-weight:700; line-height:1.4; }
.pm .ai { font-size:12px; color:var(--sub); line-height:1.6; flex:1; }
.dl { align-self:flex-start; display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:700; color:var(--accent); border:1px solid var(--accent); padding:4px 12px; margin-top:2px; }
.dl:hover { background:var(--accent); color:#fff; }
.dl svg { width:14px; height:14px; }
.foot { background:var(--black); color:#b9bcc2; margin-top:60px; }
.foot-in { max-width:1040px; margin:0 auto; padding:34px 24px 38px; font-size:12.5px; line-height:2; }
.foot .fw { color:#fff; font-weight:700; letter-spacing:.26em; font-size:12px; margin-bottom:10px; }
.foot a { color:#d7dade; text-decoration:underline; text-underline-offset:3px; }
.foot-c { border-top:1px solid #33363c; padding-top:14px; margin-top:14px; font-size:11.5px; }
/* --- カテゴリ・サイドバー --- */
.layout { display:flex; gap:34px; align-items:flex-start; }
.secs { flex:1; min-width:0; }
.catrail { position:sticky; top:64px; width:190px; flex:0 0 190px; border-top:2px solid var(--ink); padding-top:14px; margin-top:36px; }
.catrail .crlabel { font-size:10.5px; font-weight:700; letter-spacing:.22em; color:var(--sub); margin-bottom:8px; }
.catrail a { display:flex; align-items:center; gap:9px; padding:8px 0; font-size:13px; font-weight:700; color:var(--ink); border-bottom:1px solid var(--wash); }
.catrail a:hover { color:var(--accent); }
.catrail .cdot { width:9px; height:9px; flex:0 0 9px; }
.catrail .cname { flex:1; }
.catrail .cc { font-family:Georgia,serif; font-style:italic; color:var(--sub); font-size:12px; }
@media (max-width:860px){ .layout { display:block; } .catrail { display:none; } }
/* --- カード操作（解説／PDF） --- */
.th-btn { display:block; width:100%; border:none; background:none; padding:0; cursor:pointer; font-family:inherit; text-align:left; }
.pacts { display:flex; gap:8px; margin-top:2px; flex-wrap:wrap; }
.dl.kaisetsu { color:#fff; background:var(--accent); border-color:var(--accent); cursor:pointer; font-family:inherit; }
.dl.kaisetsu:hover { background:#1f49b0; border-color:#1f49b0; }
.dl.ghost { color:var(--sub); border-color:var(--line); }
.dl.ghost:hover { background:var(--wash); color:var(--ink); }
/* --- モーダル解説 --- */
.m-scrim { position:fixed; inset:0; background:rgba(14,15,17,.55); z-index:80; opacity:0; pointer-events:none; transition:opacity .2s; }
.m-scrim.show { opacity:1; pointer-events:auto; }
.modal { position:fixed; inset:0; z-index:90; display:none; align-items:flex-start; justify-content:center; padding:40px 18px; overflow-y:auto; }
.modal.open { display:flex; }
.m-card { position:relative; width:min(560px,100%); background:#fff; border:1px solid var(--ink); box-shadow:8px 8px 0 var(--ink); }
.m-close { position:absolute; top:8px; right:10px; background:none; border:none; font-size:24px; line-height:1; cursor:pointer; color:var(--ink); font-family:inherit; }
.m-head { border-top:6px solid var(--tc); padding:22px 26px 18px; border-bottom:1px solid var(--line); }
.m-tags { display:flex; gap:8px; align-items:center; margin-bottom:10px; }
.m-tag { font-size:10.5px; font-weight:700; letter-spacing:.1em; color:#fff; background:var(--tc); padding:3px 10px; }
.m-badge { font-size:10.5px; font-weight:700; color:var(--tc); border:1px solid var(--tc); padding:2px 9px; }
.m-head h3 { font-size:21px; font-weight:700; line-height:1.4; }
.m-ai { margin-top:6px; font-size:15px; font-weight:700; color:var(--tc); }
.m-body { padding:20px 26px 26px; }
.m-steps { list-style:none; counter-reset:st; margin:0 0 20px; display:flex; flex-direction:column; gap:9px; }
.m-steps li { counter-increment:st; position:relative; padding-left:34px; font-size:14.5px; line-height:1.6; }
.m-steps li::before { content:counter(st); position:absolute; left:0; top:1px; width:23px; height:23px; background:var(--tc); color:#fff; font-size:13px; font-weight:700; display:flex; align-items:center; justify-content:center; }
.m-block { border-left:3px solid var(--tc); padding:2px 0 2px 14px; margin-bottom:16px; }
.m-block .m-lbl { display:block; font-size:12px; font-weight:700; letter-spacing:.08em; color:var(--tc); margin-bottom:4px; }
.m-block p { font-size:14px; line-height:1.85; color:#2c3036; }
.m-dl { display:inline-flex; align-items:center; gap:7px; font-size:14px; font-weight:700; color:#fff; background:var(--ink); border:1px solid var(--ink); padding:9px 18px; margin-top:2px; }
.m-dl:hover { background:#000; }
.m-dl svg { width:15px; height:15px; }
.m-refs { border-top:1px solid var(--line); margin-top:18px; padding-top:14px; }
.m-refs .m-lbl { display:block; font-size:12px; font-weight:700; letter-spacing:.08em; color:var(--ink); margin-bottom:8px; }
.m-refs ul { list-style:none; display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
.m-refs li { font-size:12.5px; line-height:1.55; padding-left:14px; position:relative; }
.m-refs li::before { content:"—"; position:absolute; left:0; color:var(--sub); }
.m-refs a { color:var(--accent); text-decoration:none; }
.m-refs a:hover { text-decoration:underline; text-underline-offset:2px; }
.m-refs .ext { font-size:10px; color:var(--sub); }
.m-refnote { font-size:11px; color:var(--sub); line-height:1.6; }
.m-note { margin-top:16px; font-size:11.5px; line-height:1.75; color:var(--sub); background:var(--wash); padding:10px 14px; }
/* --- 参考文献セクション（ページ下部） --- */
.refsection { margin-top:52px; border-top:2px solid var(--ink); padding-top:8px; }
.refsection .reflead { font-size:13px; line-height:1.9; color:#3d4148; max-width:720px; margin:6px 0 18px; }
.reflist { list-style:none; display:grid; grid-template-columns:1fr 1fr; gap:8px 28px; }
.reflist li { font-size:12.5px; line-height:1.55; padding-left:15px; position:relative; }
.reflist li::before { content:"—"; position:absolute; left:0; color:var(--sub); }
.reflist a { color:var(--accent); }
.reflist a:hover { text-decoration:underline; text-underline-offset:2px; }
.reflist .ext { font-size:10px; color:var(--sub); }
@media (max-width:680px){ .reflist { grid-template-columns:1fr; } }
@media (max-width:520px){ .modal { padding:20px 10px; } .m-head,.m-body { padding-left:18px; padding-right:18px; } }
"""

DRAWER_SECS = "".join(
    f'<a class="sub2" href="#sec-{s["key"]}">{E(s["head"])}</a>' for s in sections)

MODALS = "".join(modal_html(it) for s in sections for it in s["items"] if it.get("modal"))

# 全出典リスト（ページ下部）——cards12.json の references をそのまま実URLで列挙
REFLIST = "".join(
    f'<li><a href="{E(url)}" target="_blank" rel="noopener">{E(label)}<span class="ext"> ↗</span></a></li>'
    for label, url in REFERENCES.values())
REFSECTION = (
    '<section class="refsection" id="references">'
    '<div class="sh"><span class="sbar" style="background:#0e0f11"></span>'
    '<h2>参考にした研究・資料</h2>'
    '<span class="sen">各カードの「なぜ効くのか」の根拠</span></div>'
    '<p class="reflead">このカード集は、下の研究・資料で効果が確認された支援だけを土台にしています。'
    'カードの解説は知見をかみくだいた要約で、正確な内容は各リンク先の原典をご確認ください。'
    '（英語の原典を含みます）</p>'
    f'<ul class="reflist">{REFLIST}</ul>'
    '</section>')

CATRAIL = ('<aside class="catrail"><div class="crlabel">カテゴリ</div>'
    + "".join(
        f'<a href="#sec-{s["key"]}"><span class="cdot" style="background:{s["color"]}"></span>'
        f'<span class="cname">{E(s["head"])}</span><span class="cc">{len(s["items"])}</span></a>'
        for s in sections)
    + '</aside>')

PAGE = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>支援カード ── School Stock</title>
<meta name="description" content="通常学級で使える支援カード。エビデンスのある支援を『声に出す合言葉』にした、どの教科でも使える無料カード集。掲示・机上ミニ・話型シートを無料配布。">
<style>{STYLE}</style>
</head>
<body>
<div class="topbar"><div class="topbar-in">
  <a class="wordmark" href="../">SCHOOL STOCK</a>
  <div class="nav">
    <a href="../tools/pdf-toolbox/">ツール</a>
    <a href="../prints/kokugo/">プリント</a>
    <a href="./">支援カード</a>
    <a href="../tankyu/">探究サポート</a>
    <a href="../sozai/">素材</a>
    <a href="../ideas/">アイデア村</a>
    <a href="https://note.com/tozaki_edu" target="_blank" rel="noopener">note ↗</a>
  </div>
  <button class="menu-btn" id="menuBtn" aria-label="メニューを開く"><span>≡</span>MENU</button>
</div></div>
<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-label="サイトマップ">
  <div class="drawer-head"><b>SITE MAP</b><button class="drawer-close" id="drawerClose" aria-label="閉じる">×</button></div>
  <nav>
    <a href="../">棚トップ<small>School Stock の入り口</small></a>
    <div class="dr-sec">TOOL</div>
    <a href="../tools/pdf-toolbox/">先生のPDF道具箱<small>結合・修正・縦書き。通信ゼロ</small></a>
    <div class="dr-sec">PRINTS</div>
    <a href="../prints/kokugo/">国語プリント<small>読解・言葉・作文</small></a>
    <div class="dr-sec">SUPPORT CARDS</div>
    <a href="./">支援カード<small>全{total}枚・無料</small></a>
    {DRAWER_SECS}
    <div class="dr-sec">INQUIRY</div>
    <a href="../tankyu/">探究・問題解決サポート<small>学びの地図・話型・リハーサル</small></a>
    <div class="dr-sec">MATERIALS</div>
    <a href="../sozai/">授業イラスト素材集<small>スライド・プリントに使える画像</small></a>
    <div class="dr-sec">IDEAS</div>
    <a href="../ideas/">実践アイデア村<small>授業・校務の実践アイデア集</small></a>
    <div class="dr-sec">ABOUT</div>
    <a href="../about/">このサイトについて<small>つくっている人と思い</small></a>
    <div class="dr-sec">つながる</div>
    <a href="https://note.com/tozaki_edu" target="_blank" rel="noopener">note ↗<small>制作の裏側・実践記事</small></a>
  </nav>
</aside>

<div class="container">
  <div class="head">
    <span class="kicker">SUPPORT CARDS</span>
    <h1>支援カード</h1>
    <p class="lead">つまずきのある子が「自分を助ける」ための、声に出す合言葉カード。研究で効果が確かめられた支援だけを土台に、
    どの教科・どの場面でも使えるようにしました。難易度で分けず、<b>子どもが自分に合う1枚を選ぶ</b>——その設計です。</p>
    <div class="meta"><b>全{total}枚・無料</b>　｜　掲示カード・机上ミニ版・話型シート・先生用シート　｜　A4／PDF　｜　© School Stock</div>
    <div class="note-use">カードは「配って終わり」では効きません。先生が一度いっしょにやってみせてから手渡し、できたら認める——
    その手続きとセットで使ってください（使う場と根拠は「先生用シート」にまとめてあります）。</div>
  </div>
  <div class="layout">
  {CATRAIL}
  <div class="secs">{"".join(section_html(s) for s in sections)}</div>
  </div>
  {REFSECTION}
</div>

<div class="m-scrim" id="mScrim"></div>
{MODALS}

<footer class="foot"><div class="foot-in">
  <div class="fw">SCHOOL STOCK</div>
  先生向けの、現場で使える教材・便利ツールの棚。完成品は、いつも無料です。
  <div style="margin-top:12px"><a href="../">棚トップにもどる</a>　／　<a href="https://note.com/tozaki_edu" target="_blank" rel="noopener">note ↗</a></div>
  <div class="foot-c">© School Stock（外﨑顯博 / 小学校）</div>
</div></footer>

<script>
(function(){{
  var d=document.getElementById('drawer'),s=document.getElementById('scrim');
  function open(){{d.classList.add('open');s.classList.add('show');}}
  function close(){{d.classList.remove('open');s.classList.remove('show');}}
  document.getElementById('menuBtn').addEventListener('click',open);
  document.getElementById('drawerClose').addEventListener('click',close);
  s.addEventListener('click',close);
  document.addEventListener('keydown',function(e){{if(e.key==='Escape')close();}});
}})();
(function(){{
  var sc=document.getElementById('mScrim');
  function openM(id){{var m=document.getElementById('m-'+id);if(!m)return;m.classList.add('open');sc.classList.add('show');document.body.style.overflow='hidden';m.scrollTop=0;}}
  function closeM(){{Array.prototype.forEach.call(document.querySelectorAll('.modal.open'),function(m){{m.classList.remove('open');}});sc.classList.remove('show');document.body.style.overflow='';}}
  Array.prototype.forEach.call(document.querySelectorAll('[data-modal]'),function(b){{b.addEventListener('click',function(){{openM(b.getAttribute('data-modal'));}});}});
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'),function(b){{b.addEventListener('click',closeM);}});
  sc.addEventListener('click',closeM);
  Array.prototype.forEach.call(document.querySelectorAll('.modal'),function(m){{m.addEventListener('click',function(e){{if(e.target===m)closeM();}});}});
  document.addEventListener('keydown',function(e){{if(e.key==='Escape')closeM();}});
}})();
</script>
</body>
</html>
"""

(SITE / "index.html").write_text(PAGE, encoding="utf-8")
print(f"built shien/index.html  ({total} cards, {len(sections)} sections)")
print(f"  pdf/  -> {len(list(PDFDIR.glob('*.pdf')))} files")
print(f"  thumb/ -> {len(list(THUMB.glob('*.png')))} files")
