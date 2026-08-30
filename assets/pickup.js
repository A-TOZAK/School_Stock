/* 棚トップの「PICK UP」を3日ごとに入れかえる。
 *
 * しくみ：サーバーは使わない。開いた日から順番を計算して、下の PICKUPS の1件を出す。
 *   起点日（KIJUNBI）から数えて 0〜2日目＝1番、3〜5日目＝2番、…と3日ずつ進み、
 *   最後まで行ったら1番に戻る。今は8件なので24日で一周する。
 *
 * 出し物を足す・減らす・並べかえるときは、下の PICKUPS を直すだけでよい。
 *   img   … assets/pickup/ に置いた 1000×625（16:10）の画像
 *   alt   … 画像が出ないときに読まれる説明。何が写っているかを書く
 *   tag   … 左上の小さな見出し（教科・対象）
 *   title … 教材の名前。<span class="nw"> で囲むとそこで改行しない
 *   lead  … 3〜4行の説明
 *   meta  … その下の1行（無ければ空でよい）
 *   btns  … ボタン。solid:true が濃いほう。ext:true は別タブで開く
 *
 * 画像の作り方：
 *   python3 ~/Claude/Tools/schoolstock-pickup/build.py   （元のカード画像から16:10に切る）
 * 今どれが出るかの一覧：
 *   python3 ~/Claude/Tools/schoolstock-pickup/schedule.py
 */
(function () {
  "use strict";

  var KIJUNBI = [2026, 8, 3];   // 起点日（年, 月, 日）。ここを動かすと順番がずれる
  var HIKAZU  = 3;              // 何日ごとに入れかえるか

  var PICKUPS = [
    {
      img: "assets/pickup/fukudokuhon.jpg",
      alt: "デジタル副読本の画面。左に飯塚市を空からうつした写真、右に資料のページ。写真の上に赤いペンで丸が書きこまれている",
      tag: "社会・小3／地域教材",
      title: '飯塚市 地域教材<span class="nw">デジタル副読本</span>',
      lead: '3年社会「市の様子」の地域資料を、電子黒板でも一人一台端末でも、そのまま開いて<b>ペンで書きこめる</b>Web教材にしました。「ここを見て」と印をつけながら、全員で同じ資料を読み取れます。',
      meta: "リンクを開くだけ・インストール不要／他の市町村でも同じ型でつくれます",
      btns: [
        { t: "副読本を開く ↗", href: "https://a-tozak.github.io/iizuka-fukudokuhon/", solid: true, ext: true },
        { t: "授業での使い方を読む →", href: "ideas/a/iizuka-fukudokuhon.html" }
      ]
    },
    {
      img: "assets/pickup/sozai.jpg",
      alt: "理科の素材の見本。豆電球・電池・導線・じしゃく・方位じしんが紙の上に並んでいる",
      tag: "全教科／イラスト・写真",
      title: "授業素材ライブラリ",
      lead: "スライド・ワークシート・学級通信・掲示にそのまま貼れる、自作のイラストと写真が837点。教科・学年・用途からさがせて、イラストは<b>カラーと白黒</b>を選べます。動きで見せたい場面には、GIFとMP4の「うごく解説」も。",
      meta: "全837点・クレジット表記もいりません",
      btns: [
        { t: "素材をさがす →", href: "sozai/", solid: true },
        { t: "おたよりに使うときの案内 →", href: "sozai/schools/" }
      ]
    },
    {
      img: "assets/pickup/tankyu.jpg",
      alt: "机の上で、子どもが鉛筆を持って学習カードに書きこんでいる",
      tag: "理科・社会・総合",
      title: "探究・問題解決サポート",
      lead: "「今、何をしているところなのか」が全員に見える<b>学びの地図</b>と、計画・リハーサル・振り返りのシート、話型カードです。調べ学習が「調べて終わり」になりがちな単元に。",
      meta: "全9枚・印刷して使えます",
      btns: [
        { t: "シートを見る →", href: "tankyu/", solid: true },
        { t: "対話型論証の読みもの →", href: "tankyu/taiwa-ronsho/" }
      ]
    },
    {
      img: "assets/pickup/kotoba-jiten.jpg",
      alt: "高床の倉に人々が米を運びこむ、社会科ことば辞典のイラスト",
      tag: "社会・3〜6年",
      title: "社会科ことば辞典",
      lead: "社会科の言葉を<b>絵でひける</b>辞典です。意味・例文・関連語・見方考え方までまとめてあるので、授業のふり返りや自主学習、スライドの用語説明にそのまま使えます。",
      meta: "全378語・ブラウザで開くだけ",
      btns: [
        { t: "辞典をひらく ↗", href: "https://a-tozak.github.io/shakai-kotoba-jiten/", solid: true, ext: true }
      ]
    },
    {
      img: "assets/pickup/tsukaeru.jpg",
      alt: "机でプリントに向かい、鉛筆を止めて考えこんでいる子どものイラスト",
      tag: "算数・国語",
      title: "つかえるシリーズ",
      lead: "1単元＝<b>きそ→よみとる→かんがえる→あらわす</b>の4まいと解答。基礎の1枚から、学力テストで出るような読み取り・思考・記述まで、同じ単元のまま登れます。",
      meta: "算数 全23単元・国語 全7単元",
      btns: [
        { t: "4まいを見る →", href: "prints/tsukaeru/", solid: true }
      ]
    },
    {
      img: "assets/pickup/atama.jpg",
      alt: "机で積み木を積む子どもと、「あたまのじゅんび運動」の題字",
      tag: "すきま5分・全学年",
      title: "あたまのじゅんび運動",
      lead: "勉強の前に頭をあたためる、みじかい認知機能トレーニングです。4分野を★1〜3から<b>子どもが自分で選べます</b>。書く量は少なめ、得点はつけません。朝の会、単元の合間、課題が早く終わった子に。",
      meta: "全468枚・12ヶ月ぶん",
      btns: [
        { t: "今月のぶんを見る →", href: "prints/atama/", solid: true }
      ]
    },
    {
      img: "assets/pickup/kotoba-asobi.jpg",
      alt: "ひらがなが並んだますの中から言葉をさがすプリントの盤面",
      tag: "国語・低〜中学年",
      title: "ことばあそびプリント",
      lead: "ますの中にかくれた言葉をさがす「ことばさがし」と、ふといますを集めて最後の言葉をつくる「ひらがなクロスワード」。雨の日、学級開き、待ち時間の1枚に。",
      meta: "全21枚・7テーマ×★1〜3",
      btns: [
        { t: "プリントを見る →", href: "prints/kotoba-asobi/", solid: true }
      ]
    },
    {
      img: "assets/pickup/machigai.jpg",
      alt: "公園の絵が左右に2つ並んだ、間違い探しの画像",
      tag: "朝の会・すきま時間",
      title: "間違い探しを、AIに作らせる",
      lead: "朝の3分、雨の日、課題が早く終わった子の待ち時間に。画像生成で間違い探しをその場で作るプロンプトを5本。<b>実際に生成して確かめたものだけ</b>を載せています。",
      meta: "コピペで使えます",
      btns: [
        { t: "プロンプトを見る →", href: "entertainment/machigai-sagashi/", solid: true }
      ]
    }
  ];

  var slot = document.getElementById("pickup-slot");
  if (!slot || !PICKUPS.length) return;

  // 起点日から今日までが何日目か（端末の日付で数える）
  var kijun = Date.UTC(KIJUNBI[0], KIJUNBI[1] - 1, KIJUNBI[2]);
  var now = new Date();
  var kyou = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  var hi = Math.floor((kyou - kijun) / 86400000);
  var n = PICKUPS.length;
  var i = ((Math.floor(hi / HIKAZU) % n) + n) % n;   // 起点より前の日でも落ちないようにする

  // 下見用：URLの末尾に ?pickup=2 と付けると、その番号（0から数える）を強制的に出す
  var q = /[?&]pickup=(\d+)/.exec(location.search);
  if (q) i = Number(q[1]) % n;

  var p = PICKUPS[i];
  var btns = p.btns.map(function (b) {
    return '<a' + (b.solid ? ' class="solid"' : "") + ' href="' + b.href + '"' +
           (b.ext ? ' target="_blank" rel="noopener"' : "") + ">" + b.t + "</a>";
  }).join("");

  slot.innerHTML =
    '<div class="feature">' +
      '<div class="fimg"><img src="' + p.img + '" width="1000" height="625" alt="' + p.alt + '"></div>' +
      '<div class="fbody">' +
        '<span class="ftag">' + p.tag + "</span>" +
        "<h2>" + p.title + "</h2>" +
        "<p>" + p.lead + "</p>" +
        (p.meta ? '<p class="fmeta">' + p.meta + "</p>" : "") +
        '<div class="fbtns">' + btns + "</div>" +
      "</div>" +
    "</div>";
})();
