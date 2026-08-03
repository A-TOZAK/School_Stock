#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
支援の棚の子棚「うごく解説」ページを作る。

素材棚（sozai/items.js）から type=="motion" だけを抜き出して並べ直す。
うごく解説が増えたら、このスクリプトを走らせ直すだけでこのページも増える。

  cd ~/Claude/Projects/🏪-School-Stock/shien/ugoku && python3 build_ugoku.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent                      # School_Stock/
ITEMS = ROOT / "sozai" / "items.js"

GRADE_ORDER = ["1年", "2年", "3年", "4年", "5年", "6年"]
SUBJ_ORDER = ["算数", "理科", "社会", "国語"]


def load_motion():
    t = ITEMS.read_text(encoding="utf-8")
    data = json.loads(t[t.index("["):t.rindex("]") + 1])
    m = [x for x in data if x.get("type") == "motion"]
    m.sort(key=lambda x: (SUBJ_ORDER.index(x["subject"]) if x["subject"] in SUBJ_ORDER else 9,
                          GRADE_ORDER.index(x["grade"]) if x["grade"] in GRADE_ORDER else 9,
                          x["id"]))
    return m


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def card(a):
    sec = a.get("seconds", "")
    return f"""      <div class="mc">
        <a class="mc-shot" href="../../sozai/{a['mp4']}" target="_blank" rel="noopener">
          <img src="../../sozai/{a['thumb']}" alt="{esc(a['title'])}" loading="lazy">
          <span class="mc-sec">{sec}秒</span>
        </a>
        <div class="mc-body">
          <div class="mc-tag">{esc(a['grade'])} {esc(a['subject'])}　｜　{esc(a['unit'])}</div>
          <h3>{esc(a['title'])}</h3>
          <p>{esc(a['description'])}</p>
          <div class="mc-links">
            <a href="../../sozai/{a['mp4']}" target="_blank" rel="noopener">動画（止められる）</a>
            <a href="../../sozai/{a['img']}" target="_blank" rel="noopener">GIF</a>
            <a href="../../sozai/{a['poster']}" target="_blank" rel="noopener">静止画</a>
            <a href="../../sozai/{a['alt']}" target="_blank" rel="noopener">説明の文</a>
          </div>
        </div>
      </div>"""


def build():
    m = load_motion()
    groups = {}
    for a in m:
        groups.setdefault(a["subject"], []).append(a)

    secs = []
    for subj in sorted(groups, key=lambda s: SUBJ_ORDER.index(s) if s in SUBJ_ORDER else 9):
        items = groups[subj]
        secs.append(f"""    <div class="sh"><div class="sbar"></div><h2>{esc(subj)}</h2>
      <span class="scount">{len(items)}</span></div>
    <div class="mgrid">
{chr(10).join(card(a) for a in items)}
    </div>""")

    html = HEAD + "\n".join(secs) + FOOT
    (HERE / "index.html").write_text(html.replace("__COUNT__", str(len(m))), encoding="utf-8")
    print(f"うごく解説 {len(m)}本 → {HERE / 'index.html'}")


HEAD = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>うごく解説（支援で使う） ── School Stock</title>
<meta name="description" content="止め絵では伝わらない変化・順序・道具の使い方を、10〜20秒のGIFと動画にした教材。何度でも見られて、止められて、音がない。読むのがしんどい子・一度で聞き取れない子のための棚です。">
<link rel="icon" href="../../favicon.ico" sizes="32x32">
<link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="School Stock">
<meta property="og:title" content="うごく解説（支援で使う）｜School Stock">
<meta property="og:description" content="何度でも見られて、止められて、音がない。10〜20秒のうごく教材の棚。">
<meta property="og:url" content="https://a-tozak.github.io/School_Stock/shien/ugoku/">
<meta property="og:image" content="https://a-tozak.github.io/School_Stock/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<style>
:root { --ink:#15181c; --sub:#6b7077; --accent:#2b5fd9; --paper:#fff; --wash:#f6f6f4; --line:#e6e6e3; --black:#0e0f11; }
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
.container { max-width:1040px; margin:0 auto; padding:0 24px 72px; }
.crumbs { font-size:12px; color:var(--sub); padding:22px 0 0; letter-spacing:.04em; }
.crumbs a { color:var(--sub); }
.crumbs a:hover { color:var(--ink); }
.head { border-bottom:1px solid var(--ink); padding:20px 0 26px; margin-bottom:10px; }
.kicker { display:inline-block; font-size:11.5px; font-weight:700; letter-spacing:.2em; color:#fff; background:var(--black); padding:4px 12px; margin-bottom:16px; }
.head h1 { font-size:clamp(24px,4vw,34px); font-weight:700; line-height:1.4; margin-bottom:12px; }
.head .lead { font-size:15px; color:#3d4148; line-height:1.95; max-width:680px; }
.head .lead b { color:var(--ink); }
.head .meta { margin-top:14px; font-size:12.5px; color:var(--sub); }
.head .meta b { color:var(--ink); }
.why { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:14px; margin:26px 0 6px; }
.why div { border:1px solid var(--line); padding:14px 16px; }
.why b { display:block; font-size:14px; margin-bottom:4px; }
.why span { font-size:12.5px; color:var(--sub); line-height:1.8; }
.note-use { margin:22px 0 4px; background:var(--wash); border-left:3px solid var(--accent); padding:13px 18px; font-size:13px; line-height:1.85; color:#3d4148; }
.sh { display:flex; align-items:center; gap:12px; margin:40px 0 16px; }
.sh .sbar { width:5px; height:22px; border-radius:2px; background:var(--accent); }
.sh h2 { font-size:19px; font-weight:700; }
.sh .scount { margin-left:auto; font-family:Georgia,serif; font-style:italic; font-weight:700; color:var(--sub); font-size:15px; }
.mgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:22px; }
.mc { border:1px solid var(--ink); display:flex; flex-direction:column; background:#fff; }
.mc-shot { position:relative; display:block; border-bottom:1px solid var(--line); background:var(--wash); }
.mc-shot img { display:block; width:100%; height:auto; }
.mc-sec { position:absolute; right:8px; bottom:8px; background:rgba(14,15,17,.82); color:#fff; font-size:11px; font-weight:700; letter-spacing:.06em; padding:2px 8px; }
.mc-body { padding:14px 16px 16px; display:flex; flex-direction:column; gap:6px; }
.mc-tag { font-size:11.5px; color:var(--sub); letter-spacing:.04em; }
.mc h3 { font-size:15.5px; font-weight:700; line-height:1.6; }
.mc p { font-size:12.8px; color:#3d4148; line-height:1.85; }
.mc-links { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.mc-links a { font-size:11.5px; font-weight:700; border:1px solid var(--line); padding:4px 10px; color:var(--ink); }
.mc-links a:hover { border-color:var(--ink); background:var(--wash); }
.foot { background:var(--black); color:#b9bcc2; margin-top:70px; }
.foot-in { max-width:1040px; margin:0 auto; padding:34px 24px 38px; font-size:12.5px; line-height:2; }
.foot .fw { color:#fff; font-weight:700; letter-spacing:.26em; font-size:12px; margin-bottom:10px; }
.foot a { color:#d7dade; text-decoration:underline; text-underline-offset:3px; }
.foot-c { border-top:1px solid #33363c; padding-top:14px; margin-top:14px; font-size:11.5px; }
</style>
</head>
<body>
<div class="topbar"><div class="topbar-in">
  <a class="wordmark" href="../../">SCHOOL STOCK</a>
  <div class="nav">
    <a href="../../#prints">プリント</a>
    <a href="../../#support">支援</a>
    <a href="../../#toolbox">道具</a>
    <a href="../../sozai/">素材</a>
    <a href="../../about/">このサイトについて</a>
    <a href="https://note.com/tozaki_edu" target="_blank" rel="noopener">note ↗</a>
  </div>
</div></div>

<div class="container">
  <div class="crumbs"><a href="../../">School Stock</a> ／ <a href="../">支援カード</a> ／ うごく解説</div>
  <div class="head">
    <span class="kicker">SUPPORT ｜ MOTION</span>
    <h1>うごく解説（支援で使う）</h1>
    <p class="lead">止め絵では伝わらない<b>変化・順序・道具の使い方</b>を、10〜20秒の短い動きにした教材です。
    素材棚にある「うごく」だけをここに集めました。言葉での説明が入りにくい子、一度聞いただけでは追えない子、
    板書を写しながら聞くのがしんどい子に、<b>同じ説明をそのままの形で何度でも</b>渡せます。</p>
    <div class="meta"><b>全__COUNT__本・無料</b>　｜　動画（止められる）・GIF・静止画・説明の文　｜　音なし　｜　© School Stock</div>
    <div class="why">
      <div><b>止められる</b><span>動画版は一時停止と巻きもどしができます。子どものペースで、見たいところで止められます。</span></div>
      <div><b>何度でも同じ</b><span>先生の言い方は毎回少し変わります。この教材は何度見ても同じ順・同じ言葉です。</span></div>
      <div><b>音がない</b><span>教室で流しても、まわりの音とけんかしません。聞き取りに負担のある子にも渡せます。</span></div>
      <div><b>短い</b><span>10〜20秒。1本に説明はひとつだけ。最後は止まって、読む時間があります。</span></div>
    </div>
    <div class="note-use">個別に渡すときは、動画版（止められる版）をタブレットに入れるのが使いやすいです。
    全体に見せるときはGIFのほうが手軽です。「説明の文」は、画面の内容を言葉にしたものです。
    読み上げソフトを使う子や、見えにくい子に、同じ中身を文字で渡すのに使えます。</div>
  </div>
"""

FOOT = """
</div>

<div class="foot"><div class="foot-in">
  <div class="fw">SCHOOL STOCK</div>
  先生の「明日の授業」を、少しだけ軽くする教材の棚。<br>
  <a href="../">支援カード</a>　｜　<a href="../../sozai/">素材の棚</a>　｜　<a href="../../">トップ</a>
  <div class="foot-c">© School Stock　教材は自由に使えます（授業・校内研修・配布）。</div>
</div></div>
</body>
</html>
"""

if __name__ == "__main__":
    build()
