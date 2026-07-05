#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
実践アイデア村：詳細記事ジェネレータ
- ideas/a/ に NotebookLM記事と同じ体裁の詳細ページを生成する。
- 手書き記事（notebooklm-kenshu-toi.html / forms-furikaeri.html）は対象外（上書きしない）。
- 使い方: python3 _build/build_ideas_articles.py
"""
import html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "ideas" / "a"

AUTHOR = "外﨑顯博 / 小学校"
VC = {"gemini": "#2b5fd9", "notebook": "#0e8a6d", "workspace": "#c2571a", "materials": "#7a4bd0"}
VNAME = {"gemini": "ひらめき広場", "notebook": "読み解き書斎", "workspace": "校務の工房", "materials": "教材の畑"}

# steps: まず試す3手順 / tip: つまずき・コツ（None可）
ARTICLES = [
 dict(slug="prompt-library", v="gemini", kicker="実践アイデア｜プロンプト集",
  title="AIプロンプトライブラリ",
  meta="使うもの：Gemini・NotebookLM・ChatGPT など ／ 費用：無料",
  lead="Claude、Gemini、NotebookLM……使うAIが増えるほど、「あのとき使ったプロンプト、どこに書いたっけ」が起こります。よく使うプロンプトをWeb上の棚に並べて、ワンクリックでコピーできるようにしたのがこのライブラリです。",
  can="AIツール別・業務カテゴリ別・校種と教科別にプロンプトを探して、コピーボタン1つで持ち帰れます。授業準備・教材作成・校務効率化・研修などのカテゴリに加え、小中高の授業向けの構造化プロンプトも収録しています。",
  when="授業準備や校務でAIを使いたいが、毎回ゼロから指示文を考えるのが面倒なとき。学年団や校内に「まずこれを貼ってみて」と紹介できる入口がほしいとき。",
  steps=["サイトを開き、校種・教科・AIツールで絞り込む",
         "気になるプロンプトを1つコピーして、GeminiやNotebookLMに貼って試す",
         "自分の学級に合わせて[プレースホルダ]部分を書きかえて使う"],
  tip="プロンプトは「役割・条件・出力形式」の構造で書かれています。うまく動かないときは条件を1つずつ足すより、まず出力形式（表で・箇条書きで・○字以内で）を指定し直すのが近道です。",
  url="https://a-tozak.github.io/ai-prompt-library/", urlLabel="ライブラリを開く"),

 dict(slug="kids-shakai-prompt", v="gemini", kicker="実践アイデア｜社会科×AI",
  title="子どものための社会科プロンプトライブラリ",
  meta="対象：小4以上 ／ 使うもの：Gemini・NotebookLM",
  lead="社会科でAIを使うと、子どもは「答え」だけをもらって終わりがちです。調べるヒントをもらう・考えをつくる・根拠を確かめる——学習の段階ごとに使えるプロンプトを、子ども向けに整えたライブラリです。",
  can="「調べるヒント」「考えづくり」「ブラッシュアップ」「まとめ」の場面別に、子どもがそのまま使えるプロンプトカードを選べます。子どもの入力に合わせて中身が変わる形式なので、単元を問わず使い回せます。",
  when="社会科の調べ学習でAIを使わせたいが、丸写しにならない使い方を示したいとき。資料の読み取りや根拠の確認を、AIとの対話で練習させたいとき。",
  steps=["単元と学習場面（調べる・考える・まとめる）に合うカードを選ぶ",
         "子どもがカードのプロンプトをコピーし、自分の調べたいことを入れてGeminiに貼る",
         "出てきた答えを教科書・資料集と照らし合わせて確かめる（ここが本体）"],
  tip="最初の1回は全員同じプロンプトで試すと、出力のちがい＝入力のちがいに子ども自身が気づけます。「AIの答えを確かめる」活動をセットにするのが約束です。",
  url="https://github.com/A-TOZAK/kids-social-studies-prompt-library", urlLabel="ライブラリを見る"),

 dict(slug="ikimono-zukan", v="gemini", kicker="実践アイデア｜国語×Gemini",
  title="4年国語「生き物図かん」Gemini学習サポートサイト",
  meta="対象：小4国語（書くこと） ／ 使うもの：Gemini",
  lead="生き物を選び、調べ、構成を考え、リーフレットにまとめる——この長い道のりを一人で歩くのは、4年生にはなかなか大変です。生き物の名前を入れると、学習の段階ごとのプロンプトが自動で切り替わる1ページサイトを作りました。",
  can="「選ぶ→調べる→確かめる→構成する→推敲する」の各段階で、子どもが自分の生き物名入りのプロンプトをコピーして、Geminiとの対話で学習を進められます。",
  when="「書くこと」単元で一人ひとりの題材がちがい、個別の支援が追いつかないとき。調べ学習とAIの対話を、学習過程に沿って安全に組み合わせたいとき。",
  steps=["サイトを開き、自分が調べる生き物の名前を入力する",
         "いまの学習段階（調べる・構成する など）のプロンプトをコピーしてGeminiに貼る",
         "対話の結果をワークシートやリーフレットの下書きに反映する"],
  tip="プロンプトを段階で区切ってあるのは「一気に完成品を作らせない」ためです。推敲段階のプロンプトは、自分の文章を貼って「よくするヒントを3つ」もらう形になっています。",
  url="https://a-tozak.github.io/ikimono-zukan-gemini/", urlLabel="サイトを開く"),

 dict(slug="kenshu-ict-ai", v="workspace", kicker="実践アイデア｜校内研修",
  title="研修資料「小学校の学びが変わるICTと生成AIの活用」",
  meta="対象：校内研修・自主研修 ／ 形式：スライド資料＋プロンプト例",
  lead="生成AIやICTの話は、便利ツールの紹介で終わると現場に残りません。発達段階と授業づくりにどう落とすかまで含めて、コミュニティで共有した研修資料一式をnoteで公開しています。",
  can="研修資料スライド、ふきだしくん共有プロンプト、AI検索おたすけ集など、校内でそのまま配れる形の資料が手に入ります。",
  when="校内研修でICT・生成AIを扱うことになったが、ゼロから資料を作る時間がないとき。管理職や同僚に「まずこれを見て」と渡せる資料がほしいとき。",
  steps=["note記事を開いて、資料一式にざっと目を通す",
         "自校の実態に合うスライドやプロンプト例を1つ選ぶ",
         "校内の先生向けに、紙1枚かChat投稿で紹介する（全部を配らない）"],
  tip="研修は「持ち帰って明日使えるものが1つあるか」で評価が決まります。資料のうち1つだけを深く紹介する方が、全部を紹介するより現場に残ります。",
  url="https://note.com/tozaki_edu/n/nba8d439b7040", urlLabel="研修資料を読む"),

 dict(slug="classroom-gas", v="workspace", kicker="実践アイデア｜GAS",
  title="Classroom一括削除・一括作成GAS",
  meta="対象：情報担当・管理者 ／ 使うもの：GAS・Classroom・Sheets",
  lead="年度末と新年度、Google Classroomを1つずつ消して、作って、招待して……この作業が情報担当に集中します。一覧取得から一括削除・一括作成・一括招待までをGASで支える道具です。",
  can="アクティブなコースの一覧化、不要コースの一括削除（アーカイブ）、新年度クラスの一括作成、共有ドライブから教師メールを取得しての一括招待までを、スプレッドシート上で進められます。",
  when="年度末・年度はじめのClassroom整理を、手作業のクリック連打でやっているとき。校内の全クラスを揃った名前ルールで作り直したいとき。",
  steps=["note記事の手順どおりに、まず「現在のClassroom一覧を取得」だけを試す",
         "削除対象をスプレッドシート上でチェックする（この時点ではまだ消さない）",
         "削除・作成・招待は、管理者（教育委員会・情報主任）と確認してから実行する"],
  tip="削除系のスクリプトは「一覧を見る→対象に印をつける→実行」の3段階を必ず守ってください。最初の一覧取得だけなら何も壊れないので、そこまでを練習にするのが安全です。",
  url="https://note.com/tozaki_edu/n/na08d50159da2", urlLabel="手順とコードを見る"),

 dict(slug="slides-copy-gas", v="workspace", kicker="実践アイデア｜GAS",
  title="Googleスライド全ページ一括コピーGAS",
  meta="対象：担任・教材をつくる人 ／ 使うもの：GAS・Googleスライド",
  lead="スライドでデジタルワークシートを作ると、「名前欄をどのページにも置きたい」「同じボタンを全ページに」が必ず起こります。選んだ要素を全スライドの同じ位置に一括配置するGASです。",
  can="選択した図形・テキストボックス・画像・表を、プレゼン内の全スライドの同じ位置へ一括でコピーできます。児童数ぶんのページを持つワークシートで威力を発揮します。",
  when="30枚・40枚のスライドに同じ要素を置く作業を、手でコピペしているとき。ワークシートの仕様変更（名前欄の位置変え など）が後から入ったとき。",
  steps=["コピーしたい要素（名前欄など）を1つ作って選択する",
         "note記事のコードをApps Scriptエディタに貼り、保存する",
         "スライドに追加されたメニューから「一括コピー」を実行する"],
  tip="実行前にファイルを複製しておくと安心です。GASの初回実行時に出る権限確認は、自分のアカウントのスクリプトなら承認して問題ありません。",
  url="https://note.com/tozaki_edu/n/n61be88172570", urlLabel="手順とコードを見る"),

 dict(slug="note-print", v="materials", kicker="実践アイデア｜印刷教材",
  title="すぐ印刷して使える全学年対応ノート集",
  meta="対象：全学年 ／ 形式：印刷用PDF（noteマガジン）",
  lead="5mm方眼がちょっとだけほしい。低学年用の算数ノートが1枚だけ足りない。そんな「ちょっとだけ」のために毎回探したり自作したりする時間を、ノート用紙の棚でなくします。",
  can="5mm方眼、低学年向け算数ノート、さんすうマス、こくご8マス、低学年作文ノートなど、印刷してすぐ使えるノート用紙がまとめて手に入ります。",
  when="ノートを忘れた子への1枚、宿題・自主学習用の用紙、板書計画やノート指導の型づくりに。",
  steps=["noteマガジンから必要なノート形式を選ぶ",
         "PDFをダウンロードして印刷する",
         "よく使う形式は職員室の共有フォルダに入れて学年で使い回す"],
  tip=None,
  url="https://note.com/tozaki_edu/m/m4d4dc399b274", urlLabel="ノート集を見る"),

 dict(slug="sansu-print-review", v="materials", kicker="実践アイデア｜算数×AI",
  title="小学校算数プリント集とレビューツール",
  meta="対象：小2〜小6 算数 ／ 形式：プリント集＋レビューフォーム",
  lead="生成AIで作った教材は、現場の目でレビューして直すところまでがセットです。AIで作成した算数プリント集と、先生方からの改善点を集めるレビューツールを組み合わせた実践です。",
  can="単元別・難易度別（基礎〜思考力）の算数プリントを使えます。気になった問題はレビューツールから報告でき、実際にフィードバックが反映されて改訂されていきます。",
  when="授業の補充・宿題・自学用のプリントがほしいとき。AI生成教材の「作りっぱなし」を防ぐ仕組みに興味があるとき。",
  steps=["プリント集から1単元だけ開いて、授業か宿題で使ってみる",
         "誤植・難易度・レイアウトで気になった点をレビューツールに残す",
         "改訂版が出たら差し替える"],
  tip="レビューは「どの学年・どの単元・どのレベルの何番か」を添えるだけで反映が速くなります。",
  url="https://note.com/tozaki_edu/n/n921c460a76e9", urlLabel="プリント集を見る"),

 dict(slug="iizuka-fukudokuhon", v="materials", kicker="実践アイデア｜地域教材",
  title="飯塚市 地域教材デジタル副読本",
  meta="対象：小3〜小4 社会科・総合 ／ 形式：Web教材",
  lead="地域学習の資料は、紙の副読本と配布プリントとWebにバラバラに散らばりがちです。飯塚市の地域学習に使える内容を、子どもが自分の端末で見られるデジタル副読本として整理しました。",
  can="地域の産業・歴史・くらしに関するページを、子どもが見やすいWeb形式で提示できます。授業では「問い」とセットで1ページを示す使い方ができます。",
  when="地域学習で子どもに資料を持たせたいが、紙の資料が足りない・古いとき。端末を使った調べ学習の「安全な行き先」を用意したいとき。",
  steps=["副読本を開き、単元に合うページを1つ選ぶ",
         "「このページから何が分かる？」の問いとセットで提示する",
         "分かったことをノートやスライドにまとめさせる"],
  tip="地域教材づくりは、他の市町村でも同じ型で再現できます。作り方の裏側はnote（tozaki_edu）に書いています。",
  url="https://github.com/A-TOZAK/iizuka-fukudokuhon", urlLabel="副読本を見る"),

 dict(slug="oita-source-mini", v="materials", kicker="実践アイデア｜社会科",
  title="中学社会科向け 資料読解ミニプリント集",
  meta="対象：中学校 社会科 ／ 形式：ミニプリント（Web教材）",
  lead="資料から何を読み取り、どんな根拠で考えるか。社会科のこの基礎体力は、短時間の練習をくり返すのがいちばん効きます。資料読解に絞ったミニプリント集です。",
  can="1枚数分で取り組める資料読解のミニプリントを使えます。読み取れる「事実」と自分の「考え」を分けて書かせる型になっています。",
  when="授業のはじめ5分で資料読解の練習をさせたいとき。定期テスト前の資料問題対策に。",
  steps=["ミニプリントを1枚選ぶ",
         "資料から読み取れる事実を書かせる（考えとまぜない）",
         "事実を根拠に自分の考えを書かせて、隣どうしで交流する"],
  tip=None,
  url="https://github.com/A-TOZAK/oita-source-reading-mini", urlLabel="プリント集を見る"),

 dict(slug="boardgame", v="materials", kicker="実践アイデア｜学習ゲーム",
  title="小学校現場で使える学習ボードゲーム集",
  meta="対象：小学校 全学年 ／ 形式：ブラウザで遊べるWebゲーム",
  lead="導入や復習で「楽しさ」と「学習内容」を両立させたい。でもゲーム教材を自作する時間はない。ドット絵風の学習ボードゲームを集めた棚です。",
  can="ブラウザで開くだけで遊べる学習ボードゲームを、単元・目的に合わせて選べます。インストール不要なので学校端末でもすぐ使えます。",
  when="授業の最後5分のお楽しみ兼復習に。すきま時間・雨の日の教室に。",
  steps=["単元に近いゲームを1つ選ぶ",
         "電子黒板に映して全員で1回、ルールを確かめる",
         "ペアや班で数分プレイして、出てきた用語を振り返る"],
  tip=None,
  url="https://github.com/A-TOZAK/kami-kyozai-boardgame-lab", urlLabel="ゲーム集を見る"),

 dict(slug="atama-oshiri", v="materials", kicker="実践アイデア｜ことば遊び",
  title="あたまおしりことばゲーム",
  meta="対象：小学校 全学年（特に低中学年） ／ 形式：ブラウザゲーム",
  lead="「『あ』ではじまって『り』でおわる言葉は？」——それだけのルールで、教室は思った以上に盛り上がります。語彙とかなへの関心を短時間で楽しく扱えるゲームです。",
  can="あたまとおしりの文字を指定して、言葉を考えるゲームがブラウザですぐ遊べます。朝の会・授業の導入・すきま時間の1回にちょうどいいサイズです。",
  when="朝の活動のネタがほしいとき。国語の語彙指導に遊びの入口を作りたいとき。",
  steps=["電子黒板でゲームを開く",
         "最初の1問は全員で声に出して考える",
         "慣れたらペア対抗・班対抗にする"],
  tip=None,
  url="https://github.com/A-TOZAK/atama-oshiri-game", urlLabel="ゲームで遊ぶ"),

 dict(slug="games", v="materials", kicker="実践アイデア｜学習ゲーム",
  title="授業で使えるゲーム集",
  meta="対象：小学校 ／ 形式：Webゲームのリポジトリ",
  lead="授業で使える小さなゲーム教材は、単発で作ると散らばって二度と見つかりません。作ったゲームを1か所に集めて、使い回せるようにしたリポジトリです。",
  can="授業向けの小さなゲームを一覧から選んで、ブラウザですぐ使えます。新作も同じ場所に追加されていきます。",
  when="短時間の活動ネタを探しているとき。「前に使ったあのゲーム」をもう一度使いたいとき。",
  steps=["一覧から授業に合いそうなゲームを1つ選ぶ",
         "自分で1回さわってルールを確認する",
         "活動時間を決めて（5分など）教室で使う"],
  tip=None,
  url="https://github.com/A-TOZAK/Games", urlLabel="ゲーム集を見る"),

 dict(slug="kokugo-gallery", v="materials", kicker="実践アイデア｜国語教材",
  title="国語プリントギャラリー",
  meta="対象：小学校 国語 ／ 形式：Web教材リポジトリ",
  lead="国語のプリントや作文支援教材を、必要なときにすぐ見つけて印刷できる形に整理するためのギャラリーです。School Stockの国語プリント棚の、いわば製作所側の棚です。",
  can="国語系プリントをギャラリー形式で眺めて選べます。完成した配布版はSchool Stockの国語プリント棚（読解・言葉・作文の79枚、検索つき）に並んでいます。",
  when="単元や付けたい力からプリントを探したいとき。制作の裏側や元データに興味があるとき。",
  steps=["まずはSchool Stockの国語プリント棚で検索して選ぶ",
         "目的のものがなければギャラリー側ものぞいてみる",
         "使った感想・リクエストはnoteのコメントへ"],
  tip="印刷して使うだけなら、検索と解説ページがあるSchool Stockの棚の方が速いです。",
  url="https://github.com/A-TOZAK/kokugo-print-gallery", urlLabel="ギャラリーを見る"),
]

TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} ── 実践アイデア村｜School Stock</title>
<meta name="description" content="{desc}">
<style>
  :root {{ --ink:#15181c; --sub:#767b83; --accent:{vc}; --paper:#fff; --wash:#f6f6f4; --line:#e6e6e3; --black:#0e0f11; }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic Medium",sans-serif; background:var(--paper); color:var(--ink); line-height:2; letter-spacing:0.02em; -webkit-font-smoothing:antialiased; }}
  a {{ color:var(--accent); text-decoration:none; }}
  .topbar {{ background:var(--black); color:#fff; position:sticky; top:0; z-index:40; }}
  .topbar-in {{ max-width:960px; margin:0 auto; padding:13px 24px; display:flex; justify-content:space-between; align-items:center; gap:14px; }}
  .wordmark {{ font-size:12.5px; font-weight:700; letter-spacing:0.28em; color:#fff; }}
  .topbar .nav a {{ color:#b9bcc2; font-size:11.5px; letter-spacing:0.1em; margin-left:16px; }}
  .topbar .nav a:hover {{ color:#fff; }}
  .container {{ max-width:720px; margin:0 auto; padding:0 24px 72px; }}
  .crumb {{ font-size:12px; color:var(--sub); padding:22px 0 0; }}
  .crumb a {{ color:var(--sub); text-decoration:underline; text-underline-offset:3px; }}
  .kicker {{ display:inline-block; font-size:11px; font-weight:700; letter-spacing:0.2em; color:#fff; background:var(--accent); padding:3px 11px; margin:26px 0 14px; }}
  h1 {{ font-size:clamp(24px,4.5vw,32px); font-weight:700; line-height:1.45; margin-bottom:12px; }}
  .meta {{ font-size:12.5px; color:var(--sub); margin-bottom:8px; }}
  .lead {{ font-size:15.5px; color:#3d4148; border-left:3px solid var(--accent); padding-left:14px; margin:22px 0 30px; }}
  h2 {{ font-size:19px; font-weight:700; border-bottom:1px solid var(--ink); padding-bottom:8px; margin:38px 0 14px; }}
  p {{ font-size:15px; color:#24272c; margin-bottom:14px; }}
  ol.steps {{ counter-reset:st; list-style:none; margin:14px 0; }}
  ol.steps li {{ position:relative; padding:0 0 14px 46px; font-size:15px; }}
  ol.steps li::before {{ counter-increment:st; content:counter(st); position:absolute; left:0; top:4px; width:30px; height:30px; background:var(--black); color:#fff; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:14px; }}
  .tip {{ background:var(--wash); border:1px solid var(--line); border-left:4px solid var(--accent); padding:14px 18px; margin:16px 0; font-size:13.5px; }}
  .tip b {{ color:var(--accent); }}
  .cta {{ display:inline-flex; align-items:center; gap:8px; font-size:14.5px; font-weight:700; color:#fff; background:var(--black); padding:12px 22px; margin:8px 0 4px; }}
  .back {{ display:inline-flex; font-size:13.5px; font-weight:700; color:var(--ink); border:1px solid var(--ink); padding:10px 20px; margin-top:34px; }}
  .foot {{ background:var(--black); color:#b9bcc2; margin-top:56px; }}
  .foot-in {{ max-width:960px; margin:0 auto; padding:28px 24px; font-size:12.5px; line-height:2; }}
  .foot a {{ color:#d7dade; text-decoration:underline; }}
</style>
</head>
<body>

<div class="topbar">
  <div class="topbar-in">
    <a class="wordmark" href="../../">SCHOOL STOCK</a>
    <div class="nav"><a href="../">← アイデア村にもどる</a></div>
  </div>
</div>

<div class="container">
  <div class="crumb"><a href="../../">棚</a> ／ <a href="../">実践アイデア村</a> ／ {vname}</div>

  <span class="kicker">{kicker}</span>
  <h1>{title}</h1>
  <p class="meta">作：{author} ／ {meta}</p>

  <p class="lead">{lead}</p>

  <h2>これでできること</h2>
  <p>{can}</p>

  <h2>こんなときに</h2>
  <p>{when}</p>

  <h2>まず試すなら（3ステップ）</h2>
  <ol class="steps">
{steps}
  </ol>
{tip}
  <h2>リンク</h2>
  <a class="cta" href="{url}" target="_blank" rel="noopener">{urlLabel} ↗</a>

  <br><a class="back" href="../">← アイデア村で他のアイデアを見る</a>
</div>

<footer class="foot">
  <div class="foot-in">
    <b style="color:#fff; letter-spacing:0.26em; font-size:12px;">SCHOOL STOCK</b><br>
    <a href="../../">棚トップ</a>　/　<a href="../">実践アイデア村</a>　/　<a href="https://sites.google.com/view/geg-chikuho/news-letter/20260705" target="_blank" rel="noopener">GEG Chikuho News Letter ↗</a>　/　<a href="https://note.com/tozaki_edu" target="_blank" rel="noopener">note ↗</a><br>
    © School Stock（{author}）／ GEG Chikuho
  </div>
</footer>

</body>
</html>
"""

def main():
    OUT.mkdir(exist_ok=True)
    for a in ARTICLES:
        steps = "\n".join(f"    <li>{html.escape(s)}</li>" for s in a["steps"])
        tip = f'  <div class="tip"><b>コツ：</b>{html.escape(a["tip"])}</div>\n' if a.get("tip") else ""
        page = TEMPLATE.format(
            title=html.escape(a["title"]), desc=html.escape(a["lead"][:110]),
            vc=VC[a["v"]], vname=VNAME[a["v"]], kicker=html.escape(a["kicker"]),
            author=AUTHOR, meta=html.escape(a["meta"]), lead=html.escape(a["lead"]),
            can=html.escape(a["can"]), when=html.escape(a["when"]),
            steps=steps, tip=tip, url=a["url"], urlLabel=html.escape(a["urlLabel"]))
        (OUT / f'{a["slug"]}.html').write_text(page, encoding="utf-8")
    print(f"OK: {len(ARTICLES)} article pages generated in ideas/a/")

if __name__ == "__main__":
    main()
