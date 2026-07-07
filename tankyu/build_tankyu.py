#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
School Stock 探究・問題解決サポート棚ビルダー
🧭-探究-問題解決サイト プロジェクトの items.json / pdf / png を読み込み、
PDFとサムネイルを tankyu/ に取り込んで一覧ページ index.html を生成する。
使い方: python3 tankyu/build_tankyu.py
"""
import json, re, shutil, subprocess, html
from pathlib import Path

SITE = Path(__file__).resolve().parent          # .../School_Stock/tankyu
PROJ = Path.home() / "Claude" / "Projects" / "🧭-探究-問題解決サイト"
PDFDIR = SITE / "pdf"; THUMB = SITE / "thumb"
PDFDIR.mkdir(exist_ok=True); THUMB.mkdir(exist_ok=True)

DATA = json.loads((PROJ / "items.json").read_text(encoding="utf-8"))
ITEMS = DATA["items"]
REFERENCES = DATA["references"]

def slug(s):
    s = re.sub(r"[「」『』（）()？?・\s　]", "", s)
    return s

def copy_pdf(iid, title):
    dest = PDFDIR / f"{iid}_{slug(title)}.pdf"
    shutil.copy2(PROJ / "pdf" / f"{iid}.pdf", dest)
    return dest.name

def make_thumb(iid, width=520):
    out = THUMB / f"{iid}.png"
    shutil.copy2(PROJ / "png" / f"{iid}.png", out)
    subprocess.run(["sips", "-Z", str(width), str(out)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out.name

sections = []
for sec in DATA["sections"]:
    items = []
    for iid in sec["items"]:
        c = ITEMS[iid]
        pdf = copy_pdf(iid, c["title"])
        th = make_thumb(iid)
        items.append(dict(id=iid, title=c["title"], sub=c["sub"], tag=c["tag"],
                          tagcolor=c["color"], pdf=pdf, thumb=th, modal=True,
                          aikotoba=c["aikotoba"], steps=c["steps"],
                          bamen=c["bamen"], naze=c["naze"], refs=c.get("refs", [])))
    sections.append(dict(key=sec["key"], head=sec["head"], en=sec["en"],
                         color=sec["color"], items=items))

total = sum(len(s["items"]) for s in sections)

E = html.escape
DL_SVG = ('<svg viewBox="0 0 17 17" fill="none" aria-hidden="true"><path d="M8.5 2v8m0 0L5 6.7'
          'M8.5 10l3.5-3.3M2.5 13.5h12" stroke="currentColor" stroke-width="2" '
          'stroke-linecap="round" stroke-linejoin="round"/></svg>')

def card_html(it):
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

def ref_links(keys):
    out = []
    for k in keys:
        r = REFERENCES.get(k)
        if not r:
            continue
        label, url = r
        out.append(f'<li><a href="{E(url)}" target="_blank" rel="noopener">{E(label)}<span class="ext"> ↗</span></a></li>')
    return "".join(out)

def modal_html(it):
    steps = "".join(f'<li>{E(s)}</li>' for s in it["steps"])
    refs = ref_links(it.get("refs", []))
    refs_block = (f'<div class="m-refs"><span class="m-lbl">参考にした資料・研究</span><ul>{refs}</ul>'
                  f'<p class="m-refnote">枠組みの知見をかみくだいて教材化したものです。くわしくは各リンク先の原典を参照。</p></div>') if refs else ""
    return (
      f'<div class="modal" id="m-{E(it["id"])}" role="dialog" aria-modal="true" aria-label="{E(it["title"])}">'
      f'<div class="m-card" style="--tc:{it["tagcolor"]}">'
      f'<button class="m-close" data-close aria-label="閉じる">×</button>'
      f'<div class="m-head">'
      f'<div class="m-tags"><span class="m-tag">{E(it["tag"])}</span></div>'
      f'<h3>{E(it["title"])}</h3>'
      f'<p class="m-ai">{E(it["aikotoba"])}</p></div>'
      f'<div class="m-body">'
      f'<ol class="m-steps">{steps}</ol>'
      f'<div class="m-block"><span class="m-lbl">こんなときに使う</span><p>{E(it["bamen"])}</p></div>'
      f'<div class="m-block"><span class="m-lbl">なぜ効くのか</span><p>{E(it["naze"])}</p></div>'
      f'{refs_block}'
      f'<a class="m-dl" href="pdf/{E(it["pdf"])}" target="_blank" rel="noopener">{DL_SVG}PDFをひらく</a>'
      f'<p class="m-note">掲示もシートも「配って終わり」では効きません。先生が一度いっしょに使ってみせて、毎時間の最初と最後に戻ってくる——その運用とセットで使ってください。</p>'
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
.th-btn { display:block; width:100%; border:none; background:none; padding:0; cursor:pointer; font-family:inherit; text-align:left; }
.pacts { display:flex; gap:8px; margin-top:2px; flex-wrap:wrap; }
.dl.kaisetsu { color:#fff; background:var(--accent); border-color:var(--accent); cursor:pointer; font-family:inherit; }
.dl.kaisetsu:hover { background:#1f49b0; border-color:#1f49b0; }
.dl.ghost { color:var(--sub); border-color:var(--line); }
.dl.ghost:hover { background:var(--wash); color:var(--ink); }
.m-scrim { position:fixed; inset:0; background:rgba(14,15,17,.55); z-index:80; opacity:0; pointer-events:none; transition:opacity .2s; }
.m-scrim.show { opacity:1; pointer-events:auto; }
.modal { position:fixed; inset:0; z-index:90; display:none; align-items:flex-start; justify-content:center; padding:40px 18px; overflow-y:auto; }
.modal.open { display:flex; }
.m-card { position:relative; width:min(560px,100%); background:#fff; border:1px solid var(--ink); box-shadow:8px 8px 0 var(--ink); }
.m-close { position:absolute; top:8px; right:10px; background:none; border:none; font-size:24px; line-height:1; cursor:pointer; color:var(--ink); font-family:inherit; }
.m-head { border-top:6px solid var(--tc); padding:22px 26px 18px; border-bottom:1px solid var(--line); }
.m-tags { display:flex; gap:8px; align-items:center; margin-bottom:10px; }
.m-tag { font-size:10.5px; font-weight:700; letter-spacing:.1em; color:#fff; background:var(--tc); padding:3px 10px; }
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

MODALS = "".join(modal_html(it) for s in sections for it in s["items"])

REFLIST = "".join(
    f'<li><a href="{E(url)}" target="_blank" rel="noopener">{E(label)}<span class="ext"> ↗</span></a></li>'
    for label, url in REFERENCES.values())
REFSECTION = (
    '<section class="refsection" id="references">'
    '<div class="sh"><span class="sbar" style="background:#0e0f11"></span>'
    '<h2>参考にした資料・研究</h2>'
    '<span class="sen">枠組みの根拠（探究の過程・問題解決の過程・Gold Standard PBL）</span></div>'
    '<p class="reflead">この教材は、下の公的資料・公開資料が示す枠組みを土台に、文言と設計をすべて自作したものです。'
    '解説は知見をかみくだいた要約で、正確な内容は各リンク先の原典をご確認ください。（英語の資料を含みます）</p>'
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
<title>探究・問題解決サポート ── School Stock</title>
<meta name="description" content="探究・PBL・問題解決的学習で「今、何をしているのか」を全員に見えるようにする掲示と、計画・リハーサル・振り返りのワークシート、話型カード。理科・社会・総合で使える無料教材。">
<style>{STYLE}</style>
</head>
<body>
<div class="topbar"><div class="topbar-in">
  <a class="wordmark" href="../">SCHOOL STOCK</a>
  <div class="nav">
    <a href="../tools/pdf-toolbox/">ツール</a>
    <a href="../prints/kokugo/">プリント</a>
    <a href="../shien/">支援カード</a>
    <a href="./">探究サポート</a>
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
    <a href="../shien/">支援カード<small>掲示・机上ミニ・話型シート</small></a>
    <div class="dr-sec">INQUIRY</div>
    <a href="./">探究・問題解決サポート<small>全{total}枚・無料</small></a>
    {DRAWER_SECS}
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
    <span class="kicker">INQUIRY SUPPORT</span>
    <h1>探究・問題解決サポート</h1>
    <p class="lead">探究・PBL・問題解決的な学びで、がんばる子が進む一方の「置いてけぼり」を出さないために。
    <b>「今、何をしているのか」が全員に見える</b>学びの地図と、計画・リハーサル・振り返りのワークシート、
    見通しと進み具合をことばにする話型カード。理科・社会科・総合的な学習の時間で使えます。</p>
    <div class="meta"><b>全{total}枚・無料</b>　｜　学びの地図・ワークシート・話型カード・先生用シート　｜　A4／PDF　｜　© School Stock</div>
    <div class="note-use">掲示は「貼って終わり」では効きません。毎時間のはじめに「いま ここ」を確かめる30秒とセットで使ってください
    （手立ての全体像は「先生用シート」に。発表・つなぎ言葉の基本話型は<a href="../shien/">支援カード</a>の棚にあります）。</div>
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
print(f"built tankyu/index.html  ({total} items, {len(sections)} sections)")
print(f"  pdf/  -> {len(list(PDFDIR.glob('*.pdf')))} files")
print(f"  thumb/ -> {len(list(THUMB.glob('*.png')))} files")
