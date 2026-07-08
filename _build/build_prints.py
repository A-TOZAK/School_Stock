#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
School Stock 国語プリント棚ビルダー
- prints/kokugo/{yomu,kotoba,sakubun}/ のPDFとthumb/を走査し、
  一覧ページ(index.html)と個別解説ページ(p/*.html)を生成する。
- 使い方: python3 _build/build_prints.py
"""
import os, re, html, json, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KOKUGO = ROOT / "prints" / "kokugo"
PAGES = KOKUGO / "p"

# ---- 外部リンク（サイト共通） ----
LINK_NEWSLETTER = "https://sites.google.com/view/geg-chikuho/news-letter/20260705"
LINK_GEG = "https://sites.google.com/view/geg-chikuho"
LINK_PROMPT = "https://a-tozak.github.io/ai-prompt-library/"
LINK_NOTE = "https://note.com/tozaki_edu"
LINK_GEM = "https://sites.google.com/view/gegfukuokacity/library/gem%E3%81%B2%E3%82%8D%E3%81%B0"

CATS = {
    "yomu":    {"label": "読解（読むこと）", "en": "READING",    "no": "01"},
    "kotoba":  {"label": "言葉・語句",       "en": "VOCABULARY", "no": "02"},
    "sakubun": {"label": "作文（時事・意見文）", "en": "WRITING", "no": "03"},
}

# 言葉・語句プリントの型（ファイル名に型トークンが無いもの）
KOTOBA_TYPE = {
    "1年_No01_はをへのつかいかた": "かなづかい",
    "2年_No01_かたかなで書くことば": "かたかな",
    "3年_No01_気持ちを表す言葉": "語句",
    "3年_No02_つなぎ言葉": "つなぎ言葉",
    "4年_No01_ことわざ生きもの": "ことわざ",
    "5年_No01_敬語尊敬語": "敬語",
    "6年_No01_熟語の成り立ち": "熟語",
}

BAND = {"1年":"low","2年":"low","3年":"mid","4年":"mid","中学年":"mid","5年":"high","6年":"high","高学年":"high"}
BAND_LABEL = {"low":"低学年","mid":"中学年","high":"高学年"}

# ---- 型ごとの解説素材（事実ベース：仕様と使い方だけを書く） ----
TYPE_INFO = {
    "説明文": dict(
        about="「{title}」を題材にした説明文の読解プリントです。本文を読んで、書かれている事実や理由を設問で確かめます。",
        skills=["段落ごとの要点をつかむ力","事実と理由の関係を読み取る力","本文に根拠を求めて答える習慣"],
        use=["朝学習・帯タイムの15分読解に","説明文単元の導入前後の力だめしに","宿題・自主学習の1枚として"]),
    "物語文": dict(
        about="「{title}」を題材にした物語文の読解プリントです。場面のようすや登場人物の気持ちの変化を、本文の言葉を手がかりに読み取ります。",
        skills=["場面の移り変わりをとらえる力","登場人物の気持ちを言葉から想像する力","気持ちの変化のきっかけを見つける力"],
        use=["物語文単元と並行した読解練習に","朝学習・すきま時間の1枚に","長期休みの宿題に"]),
    "要約": dict(
        about="「{title}」を題材にした要約プリントです。大事な文を選び、字数内で短くまとめる練習をします。",
        skills=["中心となる文を見分ける力","字数に合わせて言葉を選び直す力","文章全体の構成をつかむ力"],
        use=["要約指導の練習台として","高学年の予習・中学準備に","国語が得意な子の発展課題に"]),
    "詩": dict(
        about="詩「{title}」の読解プリントです。言葉のリズムや表現のくふうを味わいながら、詩の世界を読み取ります。",
        skills=["連や行のまとまりを意識して読む力","くり返し・比喩などの表現に気づく力","情景や気持ちを想像する力"],
        use=["詩の単元の導入・まとめに","音読とセットにした朝学習に","板書と組み合わせた一斉指導に"]),
    "情報の読み取り": dict(
        about="「{title}」を題材にした、図表やグラフなどの資料を読み取るプリントです。文章以外の情報から必要なことを取り出す練習をします。",
        skills=["グラフ・表から必要な情報を取り出す力","複数の情報を比べて考える力","生活の中の資料を読む実用的な力"],
        use=["学力調査対策（B問題型）の練習に","社会科・算数と関連づけた学習に","高学年の朝学習に"]),
    "語句": dict(
        about="「{title}」の10分ミニプリントです。100点満点の小テスト形式で、語句の知識をくり返し確かめられます。",
        skills=["語彙を増やし、使い分ける力","短時間で集中して取り組む習慣"],
        use=["週1回の国語小テストに","すきま時間の10分学習に","赤字解答で自己採点の練習に"]),
    "かなづかい": dict(
        about="「{title}」の10分ミニプリントです。低学年でつまずきやすいかなづかいを、小テスト形式で確かめます。",
        skills=["「は・を・へ」など表記の正しい使い分け","文を書くときの基礎の定着"],
        use=["低学年の帯タイムに","つまずきのある子の個別練習に","保護者に渡せる家庭学習用に"]),
    "かたかな": dict(
        about="「{title}」の10分ミニプリントです。かたかなで書く言葉のきまりを、小テスト形式で確かめます。",
        skills=["かたかなで書く言葉の判断","表記のきまりの定着"],
        use=["低学年の帯タイムに","かたかな指導のまとめに","家庭学習の1枚に"]),
    "つなぎ言葉": dict(
        about="「{title}」の10分ミニプリントです。文と文をつなぐ言葉のはたらきを、小テスト形式で確かめます。",
        skills=["接続語のはたらきの理解","文章の流れを組み立てる力"],
        use=["作文指導の前どりに","読解の根拠さがしとセットで","週1回の小テストに"]),
    "ことわざ": dict(
        about="「{title}」の10分ミニプリントです。ことわざの意味と使い方を、小テスト形式で楽しく確かめます。",
        skills=["ことわざの意味理解と語彙の広がり","言葉への興味・関心"],
        use=["朝の会のクイズ代わりに","国語辞典の学習とセットで","すきま時間の10分学習に"]),
    "敬語": dict(
        about="「{title}」の10分ミニプリントです。尊敬語の使い方を、小テスト形式で確かめます。",
        skills=["相手や場面に応じた敬語の使い分け","日常生活で敬語を使う意識"],
        use=["5年生の敬語単元のまとめに","委員会・行事の言葉づかい指導とセットで","小テストとして"]),
    "熟語": dict(
        about="「{title}」の10分ミニプリントです。熟語の組み立て方を、小テスト形式で確かめます。",
        skills=["熟語の成り立ちを分類する力","漢字の意味から言葉を推測する力"],
        use=["6年生の漢字学習の発展に","中学準備の語彙学習に","小テストとして"]),
    "条件作文": dict(
        about="「{title}」をテーマにした条件作文プリントです。資料（グラフや表）を読み取り、A案・B案から立場を選んで、条件に沿って自分の考えを書きます。",
        skills=["資料から根拠を取り出す力","立場を決めて理由とともに書く力","字数・条件に合わせて書く力（学力調査の記述対策）"],
        use=["標準学力調査・全国学調の記述対策に","高学年の週1作文に","学級会・話し合い活動の前どりに"]),
}

SPEC = {
    "yomu": ["A4横向き・縦書き・全漢字ルビつき","問題＋赤字解答＋解説の3枚組（答えは問題面に赤字で書きこみ済み）","学年・番号・題名入りで、複数配布しても区別しやすい","モリサワUD教科書体を埋め込み・そのまま印刷OK"],
    "kotoba": ["A4縦に同じプリントを上下2面付け（切って2人分）","100点満点の小テスト形式","2ページ目に赤字解答つき・全漢字ルビ"],
    "sakubun": ["A4横向き：右＝問題面（資料＋条件）／左＝原稿用紙（10行×20字）","標準学力調査スタイルの条件作文","資料のグラフ・表つき・そのまま印刷OK"],
}

def esc(s): return html.escape(str(s), quote=True)

def scan():
    items = []
    for cat in ["yomu", "kotoba", "sakubun"]:
        d = KOKUGO / cat
        for f in sorted(d.glob("*.pdf")):
            stem = f.stem
            if cat == "yomu":
                m = re.match(r"(中学年|高学年)_No(\d+)_([^_]+)_(.+)", stem)
                grade, no, typ, title = m.group(1), m.group(2), m.group(3), m.group(4)
            elif cat == "kotoba":
                m = re.match(r"([^_]+)_No(\d+)_語句_(.+)", stem)
                if m:
                    grade, no, typ, title = m.group(1), m.group(2), "語句", m.group(3)
                else:
                    m = re.match(r"([^_]+)_No(\d+)_(.+)", stem)
                    grade, no, title = m.group(1), m.group(2), m.group(3)
                    typ = KOTOBA_TYPE.get(stem, "語句")
            else:
                m = re.match(r"No(\d+)_(.+)", stem)
                no, title = m.group(1), m.group(2)
                grade, typ = "高学年", "条件作文"
            band = BAND.get(grade, "high")
            thumb = KOKUGO / "thumb" / (stem + ".png")
            items.append(dict(
                id=stem, cat=cat, no=int(no), type=typ, title=title,
                grade=grade, band=band,
                pdf=f"{cat}/{f.name}",
                thumb=f"thumb/{stem}.png" if thumb.exists() else None,
            ))
    return items

# ---------- 共通部品 ----------
BASE_CSS = """
  :root { --ink:#15181c; --sub:#767b83; --accent:#2b5fd9; --paper:#fff; --wash:#f6f6f4; --line:#e6e6e3; --black:#0e0f11; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic Medium",sans-serif; background:var(--paper); color:var(--ink); line-height:1.9; letter-spacing:0.02em; -webkit-font-smoothing:antialiased; }
  a { color:var(--accent); text-decoration:none; }
  .topbar { background:var(--black); color:#fff; position:sticky; top:0; z-index:40; }
  .topbar-in { max-width:960px; margin:0 auto; padding:13px 24px; display:flex; justify-content:space-between; align-items:center; gap:14px; }
  .wordmark { font-size:12.5px; font-weight:700; letter-spacing:0.28em; color:#fff; white-space:nowrap; }
  .nav { display:flex; gap:18px; align-items:center; }
  .nav a { color:#b9bcc2; font-size:11.5px; letter-spacing:0.1em; white-space:nowrap; }
  .nav a:hover { color:#fff; }
  @media (max-width:760px){ .nav { display:none; } }
  .menu-btn { display:inline-flex; align-items:center; gap:7px; font-family:inherit; font-size:11.5px; font-weight:700; letter-spacing:0.14em; color:#fff; background:none; border:1px solid #4a4e55; padding:6px 12px; cursor:pointer; }
  .drawer { position:fixed; top:0; right:0; bottom:0; width:min(320px,86vw); background:var(--paper); border-left:1px solid var(--ink); z-index:60; transform:translateX(102%); transition:transform .22s ease; overflow-y:auto; }
  .drawer.open { transform:none; }
  .drawer-head { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--ink); }
  .drawer-head b { font-size:12px; letter-spacing:0.22em; }
  .drawer-close { font-family:inherit; background:none; border:none; font-size:20px; cursor:pointer; color:var(--ink); line-height:1; }
  .drawer nav { padding:10px 0 30px; }
  .dr-sec { padding:14px 20px 4px; font-size:10.5px; font-weight:700; letter-spacing:0.2em; color:var(--sub); }
  .drawer nav a { display:block; padding:9px 20px; font-size:14px; font-weight:700; color:var(--ink); border-bottom:1px solid var(--wash); }
  .drawer nav a small { display:block; font-size:11px; font-weight:400; color:var(--sub); letter-spacing:0.04em; }
  .drawer nav a.sub2 { padding-left:34px; font-weight:400; font-size:13px; }
  .drawer nav a:hover { background:var(--wash); }
  .scrim { position:fixed; inset:0; background:rgba(14,15,17,0.4); z-index:50; opacity:0; pointer-events:none; transition:opacity .22s; }
  .scrim.show { opacity:1; pointer-events:auto; }
  .container { max-width:960px; margin:0 auto; padding:0 24px 72px; }
  .crumb { font-size:12px; color:var(--sub); letter-spacing:0.06em; padding:22px 0 0; }
  .crumb a { color:var(--sub); text-decoration:underline; text-underline-offset:3px; }
  .foot { background:var(--black); color:#b9bcc2; margin-top:56px; }
  .foot-in { max-width:960px; margin:0 auto; padding:34px 24px 38px; font-size:12.5px; line-height:2; }
  .foot .fw { color:#fff; font-weight:700; letter-spacing:0.26em; font-size:12px; margin-bottom:10px; }
  .foot a { color:#d7dade; text-decoration:underline; text-underline-offset:3px; }
  .foot-map { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px 24px; margin:14px 0 18px; }
  .foot-map b { display:block; color:#fff; font-size:11px; letter-spacing:0.18em; margin-bottom:4px; }
  .foot-map a { display:block; text-decoration:none; color:#b9bcc2; }
  .foot-map a:hover { color:#fff; text-decoration:underline; }
  .foot-c { border-top:1px solid #33363c; padding-top:14px; margin-top:6px; font-size:11.5px; }
"""

def topbar(rel):
    """rel: このページからサイトrootへの相対パス（'../..' など）"""
    return f"""
<div class="topbar">
  <div class="topbar-in">
    <a class="wordmark" href="{rel}/">SCHOOL STOCK</a>
    <div class="nav">
      <a href="{rel}/tools/pdf-toolbox/">ツール</a>
      <a href="{rel}/prints/kokugo/">プリント</a>
      <a href="{rel}/shien/">支援カード</a>
      <a href="{rel}/tankyu/">探究サポート</a>
      <a href="{rel}/sozai/">素材</a>
      <a href="{rel}/ideas/">アイデア村</a>
      <a href="{LINK_NOTE}" target="_blank" rel="noopener">note ↗</a>
    </div>
    <button class="menu-btn" id="menuBtn" aria-label="メニューを開く"><span>≡</span>MENU</button>
  </div>
</div>
<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-label="サイトマップ">
  <div class="drawer-head"><b>SITE MAP</b><button class="drawer-close" id="drawerClose" aria-label="閉じる">×</button></div>
  <nav>
    <a href="{rel}/">棚トップ<small>School Stock の入り口</small></a>
    <div class="dr-sec">TOOL</div>
    <a href="{rel}/tools/pdf-toolbox/">先生のPDF道具箱<small>結合・修正・縦書き。通信ゼロ</small></a>
    <div class="dr-sec">PRINTS</div>
    <a href="{rel}/prints/kokugo/">国語プリント<small>全79枚・無料</small></a>
    <a class="sub2" href="{rel}/prints/kokugo/#sec-yomu">読解（読むこと）</a>
    <a class="sub2" href="{rel}/prints/kokugo/#sec-kotoba">言葉・語句</a>
    <a class="sub2" href="{rel}/prints/kokugo/#sec-sakubun">作文（時事・意見文）</a>
    <div class="dr-sec">SUPPORT CARDS</div>
    <a href="{rel}/shien/">支援カード<small>声に出す合言葉カード・無料</small></a>
    <div class="dr-sec">INQUIRY</div>
    <a href="{rel}/tankyu/">探究・問題解決サポート<small>学びの地図・話型・リハーサル</small></a>
    <div class="dr-sec">MATERIALS</div>
    <a href="{rel}/sozai/">授業イラスト素材集<small>スライド・プリントに使える画像</small></a>
    <div class="dr-sec">IDEAS</div>
    <a href="{rel}/ideas/">実践アイデア村<small>授業・校務の実践アイデア集</small></a>
    <div class="dr-sec">ENTERTAINMENT</div>
    <a href="{rel}/entertainment/prompt-book/">先生の寄り道プロンプト帳<small>出張・おみやげ・すきま時間のGeminiプロンプト</small></a>
    <div class="dr-sec">ABOUT</div>
    <a href="{rel}/about/">このサイトについて<small>つくっている人と思い</small></a>
    <div class="dr-sec">つながる</div>
    <a href="{LINK_NEWSLETTER}" target="_blank" rel="noopener">GEG Chikuho News Letter ↗<small>先生のための最新情報（毎週）</small></a>
    <a href="{LINK_GEG}" target="_blank" rel="noopener">GEG Chikuho ↗<small>研修・イベントのコミュニティ</small></a>
    <a href="{LINK_PROMPT}" target="_blank" rel="noopener">AIプロンプトライブラリ ↗<small>コピペで使えるプロンプト集</small></a>
    <a href="{LINK_GEM}" target="_blank" rel="noopener">Gemひろば ↗<small>GEG Fukuoka City のGem集</small></a>
    <a href="{LINK_NOTE}" target="_blank" rel="noopener">note ↗<small>制作の裏側・実践記事</small></a>
  </nav>
</aside>
"""

def footer(rel):
    return f"""
<footer class="foot">
  <div class="foot-in">
    <div class="fw">SCHOOL STOCK</div>
    先生向けの、現場で使える教材・便利ツールの棚。完成品は、いつも無料です。
    <div class="foot-map">
      <div><b>棚の中</b>
        <a href="{rel}/">棚トップ</a>
        <a href="{rel}/tools/pdf-toolbox/">先生のPDF道具箱</a>
        <a href="{rel}/prints/kokugo/">国語プリント</a>
        <a href="{rel}/shien/">支援カード</a>
        <a href="{rel}/tankyu/">探究・問題解決サポート</a>
        <a href="{rel}/sozai/">授業イラスト素材集</a>
        <a href="{rel}/ideas/">実践アイデア村</a>
        <a href="{rel}/entertainment/prompt-book/">先生の寄り道プロンプト帳</a>
        <a href="{rel}/about/">このサイトについて</a>
      </div>
      <div><b>つながる</b>
        <a href="{LINK_NEWSLETTER}" target="_blank" rel="noopener">GEG Chikuho News Letter ↗</a>
        <a href="{LINK_GEG}" target="_blank" rel="noopener">GEG Chikuho ↗</a>
        <a href="{LINK_PROMPT}" target="_blank" rel="noopener">AIプロンプトライブラリ ↗</a>
        <a href="{LINK_GEM}" target="_blank" rel="noopener">Gemひろば（GEG Fukuoka City）↗</a>
        <a href="{LINK_NOTE}" target="_blank" rel="noopener">note ↗</a>
      </div>
    </div>
    <div style="display:flex;gap:14px;align-items:center;border-top:1px solid #33363c;margin-top:16px;padding-top:16px">
      <img src="{rel}/about/author.jpg" alt="外﨑顯博の写真" style="flex:none;width:52px;height:52px;border-radius:50%;object-fit:cover">
      <div style="font-size:12px;line-height:1.9">
        <div style="font-size:10px;font-weight:700;letter-spacing:.24em;color:#8a8f97">AUTHOR｜つくっている人</div>
        <div style="color:#fff;font-weight:700;font-size:13.5px">外﨑顯博<span style="font-weight:500;font-size:11px;color:#b9bcc2;margin-left:8px">とざき あきひろ</span></div>
        <div>福岡県の公立小学校教員／GEG Chikuho 共同リーダー。教室で使う物を自分でつくって、この棚に並べています。<a href="{rel}/about/">くわしく →</a></div>
      </div>
    </div>
    <div class="foot-c">© School Stock（外﨑顯博 / 小学校）／ 教材はすべて自作です。学校・家庭で自由に印刷して使えます（再配布・販売はご遠慮ください）。</div>
  </div>
</footer>
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
</script>
"""

DL_ICON = '<svg viewBox="0 0 17 17" fill="none" aria-hidden="true"><path d="M8.5 2v8m0 0L5 6.7M8.5 10l3.5-3.3M2.5 13.5h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

# ---------- 長期パック（夏休み・連休用のまとめzip） ----------
def build_packs(items):
    """学年帯ごとの全プリントを1つのzipに。連休・長期休み・自習用のまとめ配布向け。"""
    PACKDIR = KOKUGO / "packs"
    PACKDIR.mkdir(exist_ok=True)
    catlabel = {"yomu": "読解", "kotoba": "言葉・語句", "sakubun": "作文"}
    packs = []
    def _zip(name, label, short, sel):
        zp = PACKDIR / name
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as zf:
            for i in sel:
                zf.write(KOKUGO / i["pdf"], f"{label}/{catlabel[i['cat']]}/{Path(i['pdf']).name}")
        packs.append(dict(label=label, short=short, file=f"packs/{name}", count=len(sel),
                          mb=zp.stat().st_size / 1048576))
    _zip("国語プリント_中学年まとめパック.zip", "国語まとめパック（中学年）", "中学年パック",
         [i for i in items if i["band"] == "mid"])
    _zip("国語プリント_高学年まとめパック.zip", "国語まとめパック（高学年）", "高学年パック",
         [i for i in items if i["band"] == "high"])
    _zip("国語プリント_全部まとめパック.zip", "国語まとめパック（全学年）", "全部入り（低学年ふくむ）", items)
    return packs

# ---------- 一覧ページ ----------
def build_index(items, packs):
    counts = {c: sum(1 for i in items if i["cat"] == c) for c in CATS}
    total = len(items)

    sections = []
    for cat, meta in CATS.items():
        cards = []
        for it in (i for i in items if i["cat"] == cat):
            tags = f'<span class="tag type">{esc(it["type"])}</span><span class="tag">{esc(it["grade"])}</span>'
            img = f'<img loading="lazy" src="{esc(it["thumb"])}" alt="{esc(it["type"])} {esc(it["title"])}">' if it["thumb"] else ""
            hay = f'{it["title"]} {it["type"]} {it["grade"]} {meta["label"]}'
            cards.append(
f'''<div class="card" data-band="{it["band"]}" data-hay="{esc(hay)}">
  <a class="th" href="p/{esc(it["id"])}.html"><div class="thumb">{img}</div></a>
  <div class="b">
    <div class="tags">{tags}</div>
    <a class="tt" href="p/{esc(it["id"])}.html">{esc(it["title"])}</a>
    <div class="acts">
      <a class="more" href="p/{esc(it["id"])}.html">解説を見る</a>
      <a class="dl" href="{esc(it["pdf"])}">{DL_ICON}PDF</a>
    </div>
  </div>
</div>''')
        sections.append(f'''
  <section data-sec id="sec-{cat}">
    <div class="sec-head"><span class="sec-no">{meta["no"]}</span><span class="sec-label">{meta["en"]}</span></div>
    <h2>{meta["label"]}</h2>
    <p class="sec-note"><span class="cnt">全{counts[cat]}枚</span></p>
    <div class="grid">
{chr(10).join(cards)}
    </div>
    <p class="empty">条件に合うプリントはありません。</p>
  </section>''')

    page = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>国語プリント ── 現役教員がつくった無料の国語プリント｜School Stock</title>
<meta name="description" content="現役の小学校教員がつくった、そのまま印刷して使える国語プリント。読解・言葉・作文の3分野、全{total}枚。すべて自作・無料です。">
<style>
{BASE_CSS}
  .head {{ padding:30px 0; border-bottom:1px solid var(--ink); }}
  .kicker {{ display:inline-block; font-size:11.5px; font-weight:700; letter-spacing:0.2em; color:#fff; background:var(--black); padding:4px 12px; margin-bottom:18px; }}
  h1 {{ font-size:clamp(28px,5vw,40px); font-weight:700; line-height:1.35; margin-bottom:14px; }}
  .lead {{ font-size:15.5px; color:#3d4148; margin-bottom:18px; max-width:640px; }}
  .meta {{ font-size:12.5px; color:var(--sub); letter-spacing:0.05em; display:flex; flex-wrap:wrap; gap:6px 16px; }}
  .meta b {{ color:var(--ink); font-weight:700; }}
  .filter {{ position:sticky; top:49px; background:rgba(255,255,255,0.95); backdrop-filter:blur(6px); border-bottom:1px solid var(--line); padding:13px 0; margin-bottom:8px; z-index:5; display:flex; flex-direction:column; gap:10px; }}
  .frow {{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; }}
  .fl {{ font-size:12px; font-weight:700; letter-spacing:0.12em; color:var(--sub); margin-right:2px; }}
  .search {{ flex:1; min-width:210px; border:1px solid var(--ink); background:var(--paper); color:var(--ink); font:inherit; font-size:14px; padding:9px 12px; outline:none; }}
  .search:focus {{ box-shadow:0 0 0 3px rgba(43,95,217,0.12); }}
  .fbtn {{ font-family:inherit; font-size:13px; font-weight:700; color:var(--ink); background:var(--paper); border:1px solid var(--ink); padding:7px 14px; cursor:pointer; letter-spacing:0.04em; }}
  .fbtn.on {{ background:var(--black); color:#fff; }}
  .count {{ font-size:13px; color:var(--sub); margin:8px 0 0; }}
  .count b {{ color:var(--ink); font-weight:700; }}
  section {{ padding:34px 0 4px; }}
  .sec-head {{ display:flex; align-items:baseline; gap:13px; margin-bottom:4px; }}
  .sec-no {{ font-family:Georgia,serif; font-style:italic; font-size:21px; font-weight:700; color:var(--accent); }}
  .sec-label {{ font-size:11px; font-weight:700; letter-spacing:0.22em; color:var(--sub); }}
  h2 {{ font-size:22px; font-weight:700; margin:6px 0 4px; }}
  .sec-note {{ font-size:13px; color:var(--sub); margin-bottom:20px; }}
  .sec-note .cnt {{ color:var(--ink); font-weight:700; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:20px 18px; }}
  .card {{ border:1px solid var(--line); display:flex; flex-direction:column; transition:border-color .15s; }}
  .card:hover {{ border-color:var(--ink); }}
  .card .thumb {{ aspect-ratio:4/3; background:var(--wash); border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:center; overflow:hidden; }}
  .card .thumb img {{ max-width:100%; max-height:100%; object-fit:contain; }}
  .card .b {{ padding:13px 14px 15px; display:flex; flex-direction:column; gap:9px; flex:1; }}
  .tags {{ display:flex; gap:6px; flex-wrap:wrap; }}
  .tag {{ font-size:10.5px; font-weight:700; letter-spacing:0.04em; padding:3px 8px; border:1px solid var(--line); color:var(--sub); }}
  .tag.type {{ color:var(--accent); border-color:#cdd9f4; background:#f2f6fd; }}
  .tt {{ font-size:14.5px; font-weight:700; line-height:1.5; flex:1; color:var(--ink); }}
  .tt:hover {{ color:var(--accent); }}
  .acts {{ display:flex; align-items:center; justify-content:space-between; gap:8px; }}
  .more {{ font-size:12.5px; font-weight:700; color:var(--accent); }}
  .dl {{ display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:#fff; background:var(--black); padding:7px 13px; }}
  .dl svg {{ width:12px; height:12px; }}
  .empty {{ display:none; font-size:14px; color:var(--sub); padding:8px 0 4px; }}
  .packband {{ border:1px solid var(--ink); margin:26px 0 6px; padding:20px 22px; }}
  .packband .pb-kick {{ display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:0.2em; color:#fff; background:var(--accent); padding:3px 10px; margin-bottom:10px; }}
  .packband b.pb-t {{ display:block; font-size:17px; margin-bottom:4px; }}
  .packband .pb-note {{ font-size:12.5px; color:var(--sub); margin-bottom:14px; }}
  .pb-btns {{ display:flex; flex-wrap:wrap; gap:10px; }}
  .pbtn {{ display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:700; color:var(--ink); border:1px solid var(--ink); padding:9px 16px; }}
  .pbtn:hover {{ background:var(--black); color:#fff; }}
  .pbtn svg {{ width:14px; height:14px; }}
  .pbtn small {{ font-weight:500; font-size:11px; color:var(--sub); }}
  .pbtn:hover small {{ color:#d7dade; }}
</style>
</head>
<body>
{topbar("../..")}
<div class="container">
  <div class="crumb"><a href="../../">棚</a> ／ 国語プリント</div>
  <div class="head">
    <span class="kicker">PRINTS｜国語</span>
    <h1>国語プリント</h1>
    <p class="lead">現役の小学校教員がつくった、そのまま印刷して使える国語プリント。読解・言葉・作文の3分野、全学年ぶん。すべて自作・無料です。各プリントの「解説を見る」から、ねらい・使いどころ・関連プリントが見られます。</p>
    <div class="meta">
      <span><b>全{total}枚</b></span>
      <span>読解 {counts["yomu"]} ／ 言葉・語句 {counts["kotoba"]} ／ 作文 {counts["sakubun"]}</span>
      <span>小1〜小6</span>
      <span>© School Stock</span>
    </div>
  </div>

  <div class="packband">
    <span class="pb-kick">長期パック</span>
    <b class="pb-t">夏休み・連休・自習は、まとめてどうぞ</b>
    <p class="pb-note">学年ぶんのプリントをzipひとつにまとめました。答えは各PDFの2枚目に赤字で入っています（3枚目に解説）。</p>
    <div class="pb-btns">
{chr(10).join(f'      <a class="pbtn" href="{esc(p["file"])}" download>{DL_ICON}{esc(p["short"])} <small>{p["count"]}枚・約{p["mb"]:.0f}MB</small></a>' for p in packs)}
    </div>
  </div>

  <div class="filter">
    <div class="frow">
      <input id="q" class="search" type="search" placeholder="さがす（例: 説明文、ことわざ、グラフ、給食）">
    </div>
    <div class="frow">
      <span class="fl">学年</span>
      <button class="fbtn on" data-band="all">すべて</button>
      <button class="fbtn" data-band="low">低学年</button>
      <button class="fbtn" data-band="mid">中学年</button>
      <button class="fbtn" data-band="high">高学年</button>
      <span class="fl" style="margin-left:14px">分野</span>
      <button class="fbtn on" data-cat="all">すべて</button>
      <button class="fbtn" data-cat="sec-yomu">読解</button>
      <button class="fbtn" data-cat="sec-kotoba">言葉・語句</button>
      <button class="fbtn" data-cat="sec-sakubun">作文</button>
    </div>
    <p class="count"><b id="shown">{total}</b> 枚を表示中</p>
  </div>
{''.join(sections)}
</div>
{footer("../..")}
<script>
(function(){{
  var state = {{ q:'', band:'all', cat:'all' }};
  function apply(){{
    var shown = 0;
    document.querySelectorAll('section[data-sec]').forEach(function(sec){{
      var vis = 0;
      var catOk = state.cat==='all' || sec.id===state.cat;
      sec.querySelectorAll('.card').forEach(function(c){{
        var ok = catOk
          && (state.band==='all' || c.dataset.band===state.band)
          && (!state.q || c.dataset.hay.toLowerCase().indexOf(state.q)>=0);
        c.style.display = ok ? '' : 'none';
        if (ok) vis++;
      }});
      sec.style.display = catOk ? '' : 'none';
      sec.querySelector('.empty').style.display = (catOk && vis===0) ? 'block' : 'none';
      shown += vis;
    }});
    document.getElementById('shown').textContent = shown;
  }}
  document.getElementById('q').addEventListener('input', function(e){{ state.q = e.target.value.trim().toLowerCase(); apply(); }});
  document.querySelectorAll('.fbtn[data-band]').forEach(function(b){{
    b.addEventListener('click', function(){{
      state.band = b.dataset.band;
      document.querySelectorAll('.fbtn[data-band]').forEach(function(x){{ x.classList.toggle('on', x===b); }});
      apply();
    }});
  }});
  document.querySelectorAll('.fbtn[data-cat]').forEach(function(b){{
    b.addEventListener('click', function(){{
      state.cat = b.dataset.cat;
      document.querySelectorAll('.fbtn[data-cat]').forEach(function(x){{ x.classList.toggle('on', x===b); }});
      apply();
    }});
  }});
}})();
</script>
</body>
</html>
"""
    (KOKUGO / "index.html").write_text(page, encoding="utf-8")

# ---------- 個別ページ ----------
def related(items, it, n=6):
    same_type = [x for x in items if x["cat"]==it["cat"] and x["type"]==it["type"] and x["id"]!=it["id"] and x["band"]==it["band"]]
    same_type += [x for x in items if x["cat"]==it["cat"] and x["type"]==it["type"] and x["id"]!=it["id"] and x["band"]!=it["band"]]
    other = [x for x in items if x["cat"]==it["cat"] and x["type"]!=it["type"] and x["band"]==it["band"]]
    out, seen = [], set()
    for x in same_type + other:
        if x["id"] in seen: continue
        seen.add(x["id"]); out.append(x)
        if len(out) >= n: break
    return out

def build_pages(items):
    PAGES.mkdir(exist_ok=True)
    cat_label = {c: m["label"] for c, m in CATS.items()}
    for it in items:
        info = TYPE_INFO[it["type"]]
        about = info["about"].format(title=it["title"])
        skills = "".join(f"<li>{esc(s)}</li>" for s in info["skills"])
        uses = "".join(f"<li>{esc(s)}</li>" for s in info["use"])
        specs = "".join(f"<li>{esc(s)}</li>" for s in SPEC[it["cat"]])
        rel_cards = ""
        for r in related(items, it):
            img = f'<img loading="lazy" src="../{esc(r["thumb"])}" alt="">' if r["thumb"] else ""
            rel_cards += f'''<a class="rcard" href="{esc(r["id"])}.html"><div class="rthumb">{img}</div><div class="rb"><span class="rtag">{esc(r["type"])}・{esc(r["grade"])}</span><span class="rtt">{esc(r["title"])}</span></div></a>\n'''
        thumb_html = f'<img src="../{esc(it["thumb"])}" alt="{esc(it["title"])} のプリント見本">' if it["thumb"] else ""
        page = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(it["title"])}（{esc(it["type"])}・{esc(it["grade"])}）── 国語プリント｜School Stock</title>
<meta name="description" content="{esc(about)} 無料でそのまま印刷して使えます。">
<style>
{BASE_CSS}
  .wrap {{ display:grid; grid-template-columns:minmax(0,1fr) 260px; gap:40px; padding-top:26px; }}
  @media (max-width:860px){{ .wrap {{ grid-template-columns:1fr; }} .side {{ display:none; }} }}
  .kicker {{ display:inline-block; font-size:11px; font-weight:700; letter-spacing:0.2em; color:#fff; background:var(--black); padding:3px 11px; margin-bottom:14px; }}
  h1 {{ font-size:clamp(24px,4vw,32px); font-weight:700; line-height:1.4; margin-bottom:10px; }}
  .tags {{ display:flex; gap:6px; flex-wrap:wrap; margin-bottom:18px; }}
  .tag {{ font-size:11px; font-weight:700; padding:3px 9px; border:1px solid var(--line); color:var(--sub); }}
  .tag.type {{ color:var(--accent); border-color:#cdd9f4; background:#f2f6fd; }}
  .hero-thumb {{ border:1px solid var(--ink); background:var(--wash); margin-bottom:18px; }}
  .hero-thumb img {{ display:block; width:100%; height:auto; }}
  .dlrow {{ display:flex; flex-wrap:wrap; gap:10px; margin-bottom:26px; }}
  .dl {{ display:inline-flex; align-items:center; gap:8px; font-size:14.5px; font-weight:700; color:#fff; background:var(--black); padding:12px 22px; }}
  .dl svg {{ width:14px; height:14px; }}
  .dl.line {{ background:var(--paper); color:var(--ink); border:1px solid var(--ink); }}
  .about {{ font-size:15px; color:#3d4148; margin-bottom:26px; max-width:620px; }}
  h2 {{ font-size:17px; font-weight:700; border-left:4px solid var(--black); padding-left:11px; margin:26px 0 10px; }}
  ul.plain {{ list-style:none; }}
  ul.plain li {{ font-size:14px; color:#3d4148; padding:4px 0 4px 18px; position:relative; }}
  ul.plain li::before {{ content:""; position:absolute; left:2px; top:14px; width:7px; height:7px; background:var(--accent); }}
  .rel {{ margin-top:34px; border-top:1px solid var(--ink); padding-top:22px; }}
  .rgrid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px; }}
  .rcard {{ border:1px solid var(--line); display:flex; flex-direction:column; color:var(--ink); transition:border-color .15s; }}
  .rcard:hover {{ border-color:var(--ink); }}
  .rthumb {{ aspect-ratio:4/3; background:var(--wash); border-bottom:1px solid var(--line); overflow:hidden; display:flex; align-items:center; justify-content:center; }}
  .rthumb img {{ max-width:100%; max-height:100%; object-fit:contain; }}
  .rb {{ padding:9px 10px 11px; display:flex; flex-direction:column; gap:3px; }}
  .rtag {{ font-size:10px; font-weight:700; color:var(--sub); letter-spacing:0.04em; }}
  .rtt {{ font-size:12.5px; font-weight:700; line-height:1.5; }}
  .side {{ border-left:1px solid var(--line); padding-left:22px; }}
  .side h3 {{ font-size:11px; font-weight:700; letter-spacing:0.2em; color:var(--sub); margin:6px 0 10px; }}
  .side a {{ display:block; font-size:13.5px; font-weight:700; color:var(--ink); padding:7px 0; border-bottom:1px solid var(--wash); }}
  .side a:hover {{ color:var(--accent); }}
  .side a.ex {{ font-weight:400; color:var(--sub); font-size:12.5px; }}
  .side .now {{ color:var(--accent); }}
</style>
</head>
<body>
{topbar("../../..")}
<div class="container">
  <div class="crumb"><a href="../../../">棚</a> ／ <a href="../">国語プリント</a> ／ {esc(cat_label[it["cat"]])} ／ {esc(it["title"])}</div>
  <div class="wrap">
    <main>
      <span class="kicker">PRINTS｜{esc(cat_label[it["cat"]])}</span>
      <h1>{esc(it["title"])}</h1>
      <div class="tags"><span class="tag type">{esc(it["type"])}</span><span class="tag">{esc(it["grade"])}</span><span class="tag">無料・自作</span></div>
      <div class="hero-thumb">{thumb_html}</div>
      <div class="dlrow">
        <a class="dl" href="../{esc(it["pdf"])}">{DL_ICON}PDFをダウンロード</a>
        <a class="dl line" href="../">ほかのプリントをさがす</a>
      </div>
      <p class="about">{esc(about)}</p>
      <h2>このプリントでつく力</h2>
      <ul class="plain">{skills}</ul>
      <h2>教室での使いどころ</h2>
      <ul class="plain">{uses}</ul>
      <h2>仕様（印刷まわり）</h2>
      <ul class="plain">{specs}</ul>
      <div class="rel">
        <h2>関連プリント（タップで移動）</h2>
        <div class="rgrid">
{rel_cards}
        </div>
      </div>
    </main>
    <aside class="side">
      <h3>SITE MAP</h3>
      <a href="../../../">棚トップ</a>
      <a href="../../../tools/pdf-toolbox/">先生のPDF道具箱</a>
      <a class="now" href="../">国語プリント</a>
      <a href="../#sec-yomu">　読解（読むこと）</a>
      <a href="../#sec-kotoba">　言葉・語句</a>
      <a href="../#sec-sakubun">　作文（時事・意見文）</a>
      <a href="../../../sozai/">授業イラスト素材集</a>
      <a href="../../../ideas/">実践アイデア村</a>
      <h3 style="margin-top:20px">つながる</h3>
      <a class="ex" href="{LINK_NEWSLETTER}" target="_blank" rel="noopener">GEG Chikuho News Letter ↗</a>
      <a class="ex" href="{LINK_GEG}" target="_blank" rel="noopener">GEG Chikuho ↗</a>
      <a class="ex" href="{LINK_PROMPT}" target="_blank" rel="noopener">AIプロンプトライブラリ ↗</a>
      <a class="ex" href="{LINK_GEM}" target="_blank" rel="noopener">Gemひろば ↗</a>
      <a class="ex" href="{LINK_NOTE}" target="_blank" rel="noopener">note ↗</a>
    </aside>
  </div>
</div>
{footer("../../..")}
</body>
</html>
"""
        (PAGES / f'{it["id"]}.html').write_text(page, encoding="utf-8")

def main():
    items = scan()
    packs = build_packs(items)
    build_index(items, packs)
    build_pages(items)
    (ROOT / "_build" / "prints_kokugo_manifest.json").write_text(
        json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: index + {len(items)} detail pages generated.")
    for c in CATS: print(f"  {c}: {sum(1 for i in items if i['cat']==c)}")
    for p in packs: print(f"  pack: {p['label']} {p['count']}枚 {p['mb']:.1f}MB")

if __name__ == "__main__":
    main()
