# 見本（5年算数　割合の習熟問題）

先生の話から、1枚とカードを作った見本です。話は自作です（実在の先生、学級、学校ではありません）。
見本の中身は使わず、形と、言葉の残し方をまねてください。

## 先生の話（音声入力のまま）

> えーと、5年の算数で、割合のところなんですけど。習熟の時間に、問題が足りないなっていつも思ってて。教科書の問題だけだと、できる子はすぐ終わっちゃうし、つまずいてる子は同じ形をもう何問かやりたいし。で、Geminiに、場面と数だけ変えて、同じ形の問題を5問作ってって頼んでみました。あ、問題文は教科書のをそのまま貼ったんじゃなくて、形だけ言いました。比べる量を求める問題で、もとにする量と割合が出てくるやつ、みたいに。そしたら5問すぐ出てきて、ドキュメントに貼って刷りました。ただ、1問だけ答えがまちがってて、それ配ってから子どもに言われて気づきました。ちょっと恥ずかしかった。いまは、配る前に自分で全部解いてから刷ってます。それでも10分くらいで1枚できるので、正直だいぶ楽です。まねするなら、最初は2問くらいで頼んで、自分で解いてみるのがいいと思います。

## 見るところ

- 「えーと」「で、」「あ、」は消しています。「それ配ってから」の「それ」は言いよどみではないので残しています。「正直だいぶ楽です」「ちょっと恥ずかしかった」は残しています。
- 答えがまちがっていたことを、成功の話に書きかえていません。「課題が見えました」とまとめていません。
- 「10分くらい」は先生が言った数なので使っています。言っていない数（何人ができたか、など）は足していません。
- 時期と名前は話に出てこなかったので、meta の span を消しています。
- リンクがないので、`<p class="links">` を消しています。

## Canvas に出す1枚

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
  <h1>割合の習熟問題を、Geminiに形だけ伝えて作ってもらう</h1>
  <p class="koe">「1問だけ答えがまちがってて、それ配ってから子どもに言われて気づきました。ちょっと恥ずかしかった。」</p>
  <p class="meta"><span>5年　算数</span></p>

  <section>
    <h2><b>1</b>困りごと</h2>
    <p>習熟の時間に、問題が足りないといつも思っていました。教科書の問題だけだと、できる子はすぐ終わってしまいます。つまずいている子は、同じ形をもう何問かやりたいところでした。</p>
  </section>

  <section>
    <h2><b>2</b>試したこと</h2>
    <h3>したこと</h3>
    <ol>
      <li>問題の形だけをGeminiに伝えました。たとえば「比べる量を求める問題で、もとにする量と割合が出てくるもの」のように頼みました。教科書の問題文は貼っていません。</li>
      <li>場面と数だけを変えて、同じ形の問題を5問作ってもらいました。</li>
      <li>Google ドキュメントに貼って、刷りました。</li>
    </ol>
    <h3>どうなったか</h3>
    <p>5問はすぐに出てきました。ただ、1問だけ答えがまちがっていて、それを配ってから子どもに言われて気づきました。いまは、配る前に自分で全部解いてから刷っています。それでも10分くらいで1枚できるので、正直だいぶ楽です。</p>
  </section>

  <section>
    <h2><b>3</b>使った道具</h2>
    <ul class="tools">
      <li>Gemini</li>
      <li>Google ドキュメント</li>
    </ul>
  </section>

  <section class="ippo">
    <h2><b>4</b>次の人がまねする最初の一歩</h2>
    <p>最初は2問くらいで頼んで、配る前に自分で解いてみるのがいいと思います。</p>
  </section>

  <p class="foot">2026年11月20日に書きました。子どもの名前と学校名は入れていません。</p>
</div>
</div>
```

## チャットに出すもの

### 研修の係に渡すカード

```javascript
 ,{t:'割合の習熟問題を、Geminiに形だけ伝えて作ってもらう', v:'gemini', im:'',
  pr:'習熟の時間に、教科書の問題だけでは足りないとき。',
  ar:'問題の形だけを伝えて、場面と数を変えた同じ形の問題を5問作ってもらいました。1問だけ答えがまちがっていたので、いまは配る前に自分で解いています。',
  fs:'最初は2問くらいで頼み、配る前に自分で解いてみます。',
  to:'Gemini, Google Docs', sc:'小学校', ro:'', url:''}
```

### サムネイルの絵の注文

```
1枚お願いします。モチーフ：同じ大きさの四角い枠が5つ縦に並んだ紙と、その上に置かれた鉛筆が1本
```

### 貼り方

1. Canvas のコードを全部コピーし、研修の係が用意した校内のGoogleサイトで新しいページを作って、「埋め込む」から「埋め込みコード」に貼ります。枠の下をドラッグして、下まで見えるように伸ばします（目安は1400px）。ページの名前は、1枚の題名と同じにします。
2. 上のカードをコピーして、研修の係に渡します。渡し方は係が決めた方法にします（たとえば、共有のドキュメントに貼る）。ページを公開したあとなら、そのページの URL も一緒に渡します。カードを一覧に足すのは係の仕事なので、コードを直す必要はありません。

### 確かめてほしいこと

1. 時期と、1枚とカードに出す名前は話に出てこなかったので、空けています。入れるなら教えてください。
2. 分け方は「Geminiで考える」にしました。プリントとして置くなら「教材を作る」に変えます。
3. 題名は話の言葉から作りました。言い方を変えたいところがあれば直します。
