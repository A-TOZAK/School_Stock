/* 棚のバナー（時期で入れかえる1枠）
 *
 * なにをするか：
 *   プリントの棚で、ダウンロードの枠のすぐ下に、ほかの道具や教材への入り口を1枠だけ出す。
 *   いちばん使われている棚（ふりかえりプリント）から、ほかの棚へ行く道がフッターにしかなかったため（2026-09-18）。
 *
 * しくみ：サーバーは使わない。開いた日が「いつから〜いつまで」に入っているバナーを、上から順に探して1件出す。
 *   当てはまるものが無い日は、何も出さない（枠ごと出ない）。
 *
 * バナーを足す・入れかえるときは、下の BANNERS を直すだけでよい。
 *   id    … 数えるときの名前（半角の英数字とハイフン）。あとから変えると数がつながらなくなる
 *   from  … 出しはじめる日 [年, 月, 日]
 *   to    … 出しおわる日 [年, 月, 日]（この日も出る）
 *   place … どの棚に出すか（"furikaeri" など。住所の /prints/◯◯/ の◯◯）
 *   img   … assets/banner/ に置いた画像（横3：縦2・幅1200px・webp）
 *   alt   … 画像が出ないときに読まれる説明。何が描いてあるかを書く
 *   label … 左上の小さな見出し
 *   title … 見出し。配列で書く。1つのかたまりは途中で折れない（スマホでは、かたまりの間で折れる）
 *   lead  … 説明。配列で書く。読点や句点までが1つのかたまり（せまい画面で「です。」だけが次の行に落ちないように）
 *   btn   … ボタンの言葉（動詞1つ）
 *   href  … 行き先
 *   ext   … true なら別のタブで開く（School Stock の外のサイト）
 *
 * 数えるもの（counter.js の SS_BUMP。回数だけ。個人を追う値は送らない）：
 *   cta:banner-shown / cta:banner-shown:<id>   半分以上が画面に入った回数（1回の訪問で1回）
 *   cta:banner-click / cta:banner-click:<id>   押された回数
 *
 * 置く場所：ページに <div id="ss-banner"></div> があればそこ。無ければ「印刷の方法」（#insatsu）の直前。
 */
(function () {
  "use strict";
  if (document.getElementById("ss-banner-box")) return;

  var IMG_DIR = (window.SS_BANNER_IMG_DIR || "/School_Stock/assets/banner/");

  var BANNERS = [
    {
      id: "jiten-kokugo",
      from: [2026, 9, 18], to: [2026, 10, 31],
      place: "furikaeri",
      img: "jiten-kokugo.webp",
      alt: "水彩の絵。家のテーブルで宿題をしている子が、えんぴつを止めて、ノートパソコンの画面を見ている",
      label: "道具の棚から",
      title: ["宿題の途中で", "分からない言葉が出たら"],
      lead: ["子どもが自分で引ける、", "デジタル国語辞典です。", "リンクを開くだけで使えます。"],
      btn: "辞典をひらく",
      href: "https://a-tozak.github.io/digital-kokugo-jiten/",
      ext: true
    }
  ];

  function track(what) {
    try { if (window.SS_BUMP) window.SS_BUMP(what); } catch (e) {}
  }

  // /School_Stock/prints/furikaeri/ → "furikaeri"。見本ページでは data-place で言える
  function place(slot) {
    if (slot && slot.getAttribute("data-place")) return slot.getAttribute("data-place");
    var m = location.pathname.match(/\/School_Stock\/prints\/([^\/]+)\//);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function ymd(a) { return a[0] * 10000 + a[1] * 100 + a[2]; }

  function pick(where) {
    var d = new Date();
    var today = ymd([d.getFullYear(), d.getMonth() + 1, d.getDate()]);
    for (var i = 0; i < BANNERS.length; i++) {
      var b = BANNERS[i];
      if (b.place === where && ymd(b.from) <= today && today <= ymd(b.to)) return b;
    }
    return null;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  // かたまりごとに inline-block にする。かたまりの間でだけ折れ、入りきらない幅のときは中で折れる（はみ出さない）
  function chunks(list) {
    var out = "";
    for (var i = 0; i < list.length; i++) out += '<span class="ssb-k">' + esc(list[i]) + "</span>";
    return out;
  }

  var css = [
    "#ss-banner-box{margin:40px 0 0;border-top:1px solid #15181c;padding-top:12px;",
    "font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic Medium',sans-serif;}",
    "#ss-banner-box .ssb-label{display:block;font-size:11.5px;font-weight:700;letter-spacing:.2em;color:#6b7077;line-height:1.6;}",
    "#ss-banner-box a{display:grid;grid-template-columns:1.1fr 1fr;gap:6px 30px;align-items:center;",
    "margin-top:6px;color:#15181c;text-decoration:none;}",
    /* 絵は罫線で囲まない。紙の白がそのままページの白につながる */
    "#ss-banner-box .ssb-img{display:block;aspect-ratio:3/2;background:#fff;}",
    "#ss-banner-box .ssb-img img{display:block;width:100%;height:100%;object-fit:contain;}",
    "#ss-banner-box .ssb-body{display:flex;flex-direction:column;align-items:flex-start;gap:10px;}",
    "#ss-banner-box .ssb-k{display:inline-block;}",
    "#ss-banner-box .ssb-h{font-size:22px;font-weight:700;line-height:1.5;letter-spacing:.03em;}",
    "#ss-banner-box .ssb-p{font-size:14px;line-height:1.85;color:#3d4148;}",
    "#ss-banner-box .ssb-btn{display:inline-block;font-size:13.5px;font-weight:700;letter-spacing:.06em;",
    "color:#fff;background:#15181c;padding:11px 20px;line-height:1.5;margin-top:4px;}",
    /* 指で押す画面ではホバーの色が残るので、マウスのある画面でだけ色を変える */
    "@media (hover:hover){#ss-banner-box a:hover .ssb-btn{background:#2b5fd9;}}",
    "#ss-banner-box a:focus-visible .ssb-btn{background:#2b5fd9;}",
    "#ss-banner-box a:focus-visible{outline:2px solid #2b5fd9;outline-offset:4px;}",
    "@media (max-width:760px){",
    "#ss-banner-box{margin-top:32px;}",
    "#ss-banner-box a{grid-template-columns:1fr;gap:4px;}",
    "#ss-banner-box .ssb-h{font-size:20px;}",
    "#ss-banner-box .ssb-body{gap:8px;padding-bottom:4px;}}",
    "@media print{#ss-banner-box{display:none !important;}}"
  ].join("");

  function build() {
    var slot = document.getElementById("ss-banner");
    var b = pick(place(slot));
    if (!b) return;

    var anchor = slot || document.getElementById("insatsu");
    if (!anchor || !anchor.parentNode) return;

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var box = document.createElement("aside");
    box.id = "ss-banner-box";
    box.setAttribute("aria-label", b.label);
    box.innerHTML =
      '<span class="ssb-label">' + esc(b.label) + "</span>" +
      '<a href="' + esc(b.href) + '"' + (b.ext ? ' target="_blank" rel="noopener"' : "") + ">" +
        '<span class="ssb-img"><img src="' + esc(IMG_DIR + b.img) + '" alt="' + esc(b.alt) +
          '" width="1200" height="800" loading="lazy" decoding="async"></span>' +
        '<span class="ssb-body">' +
          '<b class="ssb-h">' + chunks(b.title) + "</b>" +
          '<span class="ssb-p">' + chunks(b.lead) + "</span>" +
          '<span class="ssb-btn">' + esc(b.btn) + (b.ext ? " ↗" : " →") + "</span>" +
        "</span>" +
      "</a>";

    if (slot) { slot.parentNode.replaceChild(box, slot); }
    else { anchor.parentNode.insertBefore(box, anchor); }

    box.querySelector("a").addEventListener("click", function () {
      track("cta:banner-click");
      track("cta:banner-click:" + b.id);
    });

    // 半分以上が画面に入ったら1回だけ数える。読み直しでは数えない
    var KEY = "ss_bn_" + b.id;
    function shown() {
      try {
        if (sessionStorage.getItem(KEY)) return;
        sessionStorage.setItem(KEY, "1");
      } catch (e) {}
      track("cta:banner-shown");
      track("cta:banner-shown:" + b.id);
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) {
          if (es[i].isIntersecting) { shown(); io.disconnect(); break; }
        }
      }, { threshold: 0.5 });
      io.observe(box);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
