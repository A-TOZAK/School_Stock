# 見本の作りの説明

このファイルは、Geminiのスキル「tangen-site」に入っているファイルの1つです。
前に、元のプロンプトで、4年理科「とじこめた空気と水」（全6時間）の単元サイトをGeminiに作らせました。
そのページの、よかったところと直したところを書きます。直したあとの部品の書き方も、下にのせます。
見本の中身（空気と水の言葉や問題）は使わずに、先生が貼った計画から作ってください。形だけをまねます。

## 1. よかったところ（このまま続ける）

- 学習の地図を、1時間1枚のカードで6枚並べていました。どの時間に何が分かったかが、上から順に読めます。
- 安全の約束を、計画に書いてあった3つだけ、番号つきで書いていました。自分で約束を足していませんでした。
- 実験ごとに、手順を番号つきで書き、その下に図を置いていました。図には「おす力」の矢印と「目もりを読む」の矢印があり、どこを見ればよいかが分かりました。
- たしかめ問題は、何回でも選び直せました。記録を外に送るしくみはありませんでした。
- 「先生へ」に、学習指導要領の項目を、計画に書いてあったとおりにまとめていました。

## 2. 直したところ（この形で作る）

| 前の見本 | 直した形 | わけ |
|---|---|---|
| 「もっと奥にすすむ」「縮まない」「正解」「目盛り」 | 「もっとおくへすすむ」「ちぢまない」「せいかい」「目もり」 | 「奥」は表にない字、「縮」「盛」は6年、「解」は5年の字。4年の子は読めません |
| 「たいせき」「じっけん」「ちゅうしゃき」 | 「体積」「実験」「ちゅうしゃ器」 | 4年までに習う字は、そのまま書く。ひらがなにしすぎると、黒板やノートの字とつながりません |
| 「たいせきや 手ごたえは どうなるのだろうか」 | 「体積や手ごたえは、どうなるのだろうか」 | 言葉の間に空白を入れません。読点で区切ります |
| 強調の色が、赤、だいだい、むらさき、緑、青の5色 | 赤の1色。ほかは黒と灰色 | 色が多いと、どこが大事か分からなくなります |
| まちがえたときは「× ざんねん！ もう一度 かんがえてみよう。」だけ | 「× もう一度考えよう。ヒント：5時間めのカードを見てみよう。」 | どこを見返せばよいかが分かると、子どもが自分で地図にもどれます |
| 図の字が14から16の大きさ（viewBox の幅500） | viewBox の幅400で、字は20以上 | スマホの幅では、字が10pxくらいまで小さくなっていました |
| 「1ページ完結型Web教材」「個人閲覧」 | 「授業のあとに、子どもが自分で見返すページです」 | 先生が読むところも、ふだんの言葉で書きます |

## 3. 直したあとの部品

### 地図のカード

まとめが2文のときは、2文のまま書きます（4時間め）。

```html
<li>
  <p class="ji">4時間め</p>
  <p class="meate">めあて：実験の結果から、空気について何が言えるのだろうか。</p>
  <p class="wakatta">分かったこと：とじこめた空気は、おすと体積が小さくなる。体積が小さくなるほど、おし返す力は大きくなる。</p>
</li>
<li>
  <p class="ji">5時間め</p>
  <p class="meate">めあて：とじこめた水をおすと、体積と手ごたえはどうなるのだろうか。</p>
  <p class="wakatta">分かったこと：水は、強くおしても、目もりが動かない。</p>
</li>
```

### たしかめ問題（3つから1つを選ぶ）

正しい答えは3番めのボタンなので、`data-seikai` は2です（いちばん上が0）。

```html
<div class="q" data-seikai="2" data-setsumei="水は、おしちぢめられないので、体積は変わりません。" data-hint="5時間めのカードを見てみよう。">
  <p class="mon">3．とじこめた水をおすと、体積はどうなりますか。</p>
  <div class="sentaku">
    <button type="button" data-i="0" aria-pressed="false">ア　小さくなる</button>
    <button type="button" data-i="1" aria-pressed="false">イ　大きくなる</button>
    <button type="button" data-i="2" aria-pressed="false">ウ　変わらない</button>
  </div>
  <p class="kotae" aria-live="polite"></p>
</div>
```

### たしかめ問題（○×）

```html
<div class="q" data-seikai="0" data-setsumei="空気は、おすと体積が小さくなります。" data-hint="3時間めのカードを見てみよう。">
  <p class="mon">4．とじこめた空気をおすと、体積は小さくなる。</p>
  <div class="sentaku">
    <button type="button" data-i="0" aria-pressed="false">○</button>
    <button type="button" data-i="1" aria-pressed="false">×</button>
  </div>
  <p class="kotae" aria-live="polite"></p>
</div>
```

### 手順の図（ちゅうしゃ器）

目もりは線だけをかき、数はかきません。見てほしいところは赤にします。

```html
<figure>
  <svg viewBox="0 0 400 220" role="img" aria-label="ちゅうしゃ器の先をゴム板でふさぎ、ピストンをおして目もりを見る図">
    <defs>
      <marker id="ya1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#c8331f"/>
      </marker>
    </defs>
    <rect x="20" y="70" width="24" height="70" fill="#ffffff" stroke="#1d1d1f" stroke-width="3"/>
    <rect x="44" y="80" width="200" height="50" fill="#ffffff" stroke="#1d1d1f" stroke-width="3"/>
    <line x1="84" y1="80" x2="84" y2="92" stroke="#1d1d1f" stroke-width="2"/>
    <line x1="124" y1="80" x2="124" y2="92" stroke="#1d1d1f" stroke-width="2"/>
    <line x1="164" y1="80" x2="164" y2="92" stroke="#1d1d1f" stroke-width="2"/>
    <line x1="204" y1="80" x2="204" y2="92" stroke="#1d1d1f" stroke-width="2"/>
    <rect x="150" y="83" width="12" height="44" fill="#1d1d1f"/>
    <line x1="162" y1="105" x2="290" y2="105" stroke="#1d1d1f" stroke-width="6"/>
    <line x1="290" y1="85" x2="290" y2="125" stroke="#1d1d1f" stroke-width="6"/>
    <line x1="380" y1="105" x2="300" y2="105" stroke="#c8331f" stroke-width="4" marker-end="url(#ya1)"/>
    <text x="345" y="88" font-size="20" text-anchor="middle" fill="#c8331f" font-weight="700">おす</text>
    <text x="32" y="60" font-size="20" text-anchor="middle" fill="#1d1d1f">ゴム板</text>
    <line x1="156" y1="190" x2="156" y2="140" stroke="#c8331f" stroke-width="3" marker-end="url(#ya1)"/>
    <text x="156" y="212" font-size="20" text-anchor="middle" fill="#c8331f" font-weight="700">目もりを見る</text>
  </svg>
  <figcaption>ピストンをおしたとき、ピストンがどこまで動いたかを、目もりで見ます。</figcaption>
</figure>
```

## 4. 本人が作った単元サイトから借りた考え

School Stock には、先生向けの単元のページ（4年算数「面積」、4年理科「すずしくなると」）があります。そこで守っていることを、子ども向けのこのページにも使います。

- 教科書のページ番号は書きますが、教科書の紙面と本文はのせません。文と図は自分で作ります。
- 計画にある数値が自作の例のときは、そう書きます。学級の記録に合わせて直せるようにします。
- 黒板とノートと同じ言葉（めあて、まとめ、問題の言い方）を使います。子どもが、黒板で見た言葉をページの中で見つけられるようにします。
- いちばん下に、自作であることと、のせていないものを書きます。
