# 1枚の型と見た目の決まり

先生の話から作る1枚は、すべてこの型で作ります。中の言葉だけを入れかえます。
どの先生の1枚も同じ形にそろうので、先生にセンスを求めずにすみます。校内で何枚並んでも、見た目がばらばらになりません。

## 見た目の決まり

| 項目 | 決まり |
|---|---|
| 地 | 白（#ffffff） |
| 字 | 黒に近い墨色（#15181c）。補足の字は灰色（#5c6168） |
| 強調 | 藍色（#2b5fd9）の1色だけ。使うのは「最初の一歩」の欄と、リンクだけ |
| 区切り | 細い罫線（#e3e3e0）と、見出しの下の黒い線1本。色の面で区切らない |
| 形 | 角を丸めない。影を付けない。グラデーションを使わない |
| 字の大きさ | 本文17px。見出しの題名は24pxから32px。いちばん小さい字でも13px |
| フォント | 端末に入っている日本語のゴシック体。外のフォントは読みこまない |
| 幅 | いちばん広くて720px。スマートフォンでは1列のまま縮む |
| 絵と写真 | 入れない（サムネイルの絵はカードの方に付ける） |

## 言葉を入れる場所

【　】のところだけを、先生の話の言葉に入れかえます。【　】の中の説明は消します。

| 場所 | 入れるもの |
|---|---|
| 【題名】 | 何をしたかが分かる題名。30字まで。先生の言葉を使う |
| 【先生の言葉】 | 話の中で、いちばんその人らしい一言。言いよどみだけ消して、そのまま |
| 【場面】 | 学年と教科。例は「5年　算数」。校務なら仕事の名前。例は「学年だより」 |
| 【時期】 | 例「2026年度　2学期」。話に出てこなければ、このspanを消す |
| 【名前】 | 1枚に出す名前。先生が言わなければ、このspanを消す |
| 【困りごと】 | 1文から3文 |
| 【したこと】 | 手順を2つから5つ。1つを1文で |
| 【どうなったか】 | よかったことも、うまくいかなかったことも、先生の言葉で。1文から4文 |
| 【道具】 | 使った道具を1つずつ `<li>` に |
| 【リンク】 | 先生がくれたリンクだけ。なければ、この `<p class="links">` を消す |
| 【作ったものの名前】 | リンクの先にあるものを、先生が呼んだ名前で書く。例は「割合の練習プリント」。リンクがなければ、リンクと一緒に消す |
| 【最初の一歩】 | 明日すぐできる1つ。1文か2文 |
| 【作った日】 | 例「2026年11月20日」 |

- 字の中の `<` `>` `&` は、`&lt;` `&gt;` `&amp;` にします。
- 手順が1つしかないときは、`<ol>` を消して `<p>` にします。
- 話に出てこなかった欄は、欄を消さずに `<p class="aki">話に出てこなかったので空けています。</p>` を入れます。

## 型（このまま使う）

```html
<div id="ichimai" lang="ja">
<style>
#ichimai, #ichimai *{box-sizing:border-box; margin:0; padding:0}
#ichimai{
  --ink:#15181c; --sub:#5c6168; --line:#e3e3e0; --accent:#2b5fd9; --paper:#ffffff;
  font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","BIZ UDPGothic","Noto Sans JP","Yu Gothic Medium",sans-serif;
  background:var(--paper); color:var(--ink); line-height:1.9; letter-spacing:.02em;
  -webkit-font-smoothing:antialiased;
}
#ichimai .w{max-width:720px; margin:0 auto; padding:40px 24px 48px}
#ichimai .kick{font-size:13px; font-weight:700; letter-spacing:.18em; color:var(--sub)}
#ichimai h1{font-size:clamp(24px,5vw,32px); font-weight:700; line-height:1.45; margin:10px 0 0; word-break:auto-phrase}
#ichimai .koe{font-size:19px; font-weight:700; line-height:1.75; margin:22px 0 0; word-break:auto-phrase}
#ichimai .meta{
  display:flex; flex-wrap:wrap; gap:6px 22px; margin-top:18px; padding-bottom:20px;
  border-bottom:1px solid var(--ink); font-size:14px; color:var(--sub);
}
#ichimai section{padding:26px 0; border-bottom:1px solid var(--line)}
#ichimai h2{font-size:15px; font-weight:700; letter-spacing:.1em; color:var(--sub); margin-bottom:10px}
#ichimai h2 b{font-family:Georgia,serif; font-style:italic; font-weight:400; font-size:20px; color:var(--ink); margin-right:12px}
#ichimai h3{font-size:14px; font-weight:700; color:var(--sub); margin:16px 0 4px}
#ichimai h3:first-of-type{margin-top:0}
#ichimai p, #ichimai li{font-size:17px}
#ichimai ol{padding-left:1.5em}
#ichimai ol li{padding-left:.2em}
#ichimai .tools{list-style:none; display:flex; flex-wrap:wrap; gap:8px}
#ichimai .tools li{font-size:15px; border:1px solid var(--ink); padding:2px 12px}
#ichimai .links{margin-top:14px}
#ichimai a{color:var(--accent); text-underline-offset:3px}
#ichimai .aki{color:var(--sub)}
#ichimai section:has(+ .ippo){border-bottom:0}
#ichimai .ippo{border-top:3px solid var(--accent); border-bottom:0; margin-top:8px}
#ichimai .ippo h2{color:var(--accent)}
#ichimai .ippo h2 b{color:var(--accent)}
#ichimai .ippo p{font-size:19px; font-weight:700; line-height:1.8; word-break:auto-phrase}
#ichimai .foot{margin-top:8px; padding-top:16px; border-top:1px solid var(--line); font-size:13px; color:var(--sub)}
@media(max-width:520px){
  #ichimai .w{padding:28px 18px 36px}
  #ichimai .koe{font-size:18px}
}
</style>

<div class="w">
  <p class="kick">この学期、こう使ってみた</p>
  <h1>【題名】</h1>
  <p class="koe">「【先生の言葉】」</p>
  <p class="meta"><span>【場面】</span><span>【時期】</span><span>【名前】</span></p>

  <section>
    <h2><b>1</b>困りごと</h2>
    <p>【困りごと】</p>
  </section>

  <section>
    <h2><b>2</b>試したこと</h2>
    <h3>したこと</h3>
    <ol>
      <li>【したこと1】</li>
      <li>【したこと2】</li>
    </ol>
    <h3>どうなったか</h3>
    <p>【どうなったか】</p>
  </section>

  <section>
    <h2><b>3</b>使った道具</h2>
    <ul class="tools">
      <li>【道具1】</li>
      <li>【道具2】</li>
    </ul>
    <p class="links"><a href="【リンク】" target="_blank" rel="noopener">【作ったものの名前】</a></p>
  </section>

  <section class="ippo">
    <h2><b>4</b>次の人がまねする最初の一歩</h2>
    <p>【最初の一歩】</p>
  </section>

  <p class="foot">【作った日】に書きました。子どもの名前と学校名は入れていません。</p>
</div>
</div>
```

## してはいけないこと

- 型の CSS を書きかえる（色を足す、角を丸める、影を付ける、背景に色を敷く）
- `<html>` `<head>` `<body>` で包む（Googleサイトの埋め込みコードには、この `<div>` だけを貼る）
- `<script>`、外のフォント、CDN、Tailwind、画像を足す
- 欄の順番を変える、欄を足す（4つの欄と、題名、先生の言葉だけ）
- 絵文字を入れる
