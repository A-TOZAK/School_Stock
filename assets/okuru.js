/* School Stock スマホで見つけた人が、パソコンへリンクを送る案内
 * - スマホの幅（820px未満）のときだけ、ページのいちばん上に1行の帯を出す
 * - 帯を押すと開く。中身は3つ
 *     1) リンクを自分に送る（navigator.share。使えない端末ではボタンを出さない）
 *     2) リンクをコピーする（navigator.clipboard。だめなら URL を字で出す）
 *     3) パソコンで探すときの検索の言葉「School Stock 教材」
 * - 送るのは、いま見ているページの住所（学年や月の # もそのまま）
 * - 右下の相談窓口ボタン（soudan.js）と重ならないよう、固定せずページの流れの中に置く
 * - 印刷時は消える。クッキーは使わない
 */
(function () {
  "use strict";
  if (document.getElementById("ss-okuru")) return;
  if (window.innerWidth >= 820) return;
  // 出したくないページは head に <meta name="ss-okuru" content="off"> を置く（404.html など）
  if (document.querySelector('meta[name="ss-okuru"][content="off"]')) return;
  // 自前の案内を持っている道具では出さない
  if (location.pathname.indexOf("/tools/masume-print/") !== -1) return;

  function bump(k) { try { if (window.SS_BUMP) window.SS_BUMP(k); } catch (e) {} }

  var css = [
    "#ss-okuru{background:#f6f6f4;border-bottom:1px solid #e6e6e3;color:#15181c;",
    "font-family:\"Hiragino Sans\",\"Hiragino Kaku Gothic ProN\",\"Noto Sans JP\",\"Yu Gothic Medium\",sans-serif;",
    "font-size:14px;line-height:1.7;text-align:left;-webkit-text-size-adjust:100%}",
    "#ss-okuru *{box-sizing:border-box}",
    "#ss-okuru-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:46px;",
    "padding:8px 16px;margin:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}",
    "#ss-okuru-bar b{font-weight:600}",
    "#ss-okuru-bar span.go{flex:none;color:#2b5fd9;font-weight:600;white-space:nowrap}",
    "#ss-okuru-bar span.go:after{content:\"\";display:inline-block;width:7px;height:7px;margin-left:7px;",
    "border-right:2px solid #2b5fd9;border-bottom:2px solid #2b5fd9;transform:rotate(45deg) translateY(-3px);transition:transform .15s}",
    "#ss-okuru.open #ss-okuru-bar span.go:after{transform:rotate(-135deg) translateY(-2px)}",
    "#ss-okuru-body{display:none;padding:4px 16px 18px}",
    "#ss-okuru.open #ss-okuru-body{display:block}",
    "#ss-okuru-body p{margin:0 0 12px}",
    "#ss-okuru-btns{display:flex;flex-direction:column;gap:8px;margin:0 0 10px}",
    "#ss-okuru-btns button{display:block;width:100%;min-height:48px;padding:10px 14px;border-radius:8px;font:inherit;font-weight:600;",
    "font-size:15px;cursor:pointer;border:1px solid #15181c;background:#fff;color:#15181c}",
    "#ss-okuru-btns button.pri{background:#15181c;color:#fff}",
    "#ss-okuru-msg{min-height:0;margin:0 0 10px;font-size:13px;color:#2b5fd9;word-break:break-all}",
    "#ss-okuru-msg:empty{display:none}",
    "#ss-okuru-url{display:block;margin-top:6px;padding:8px 10px;border:1px solid #e6e6e3;border-radius:6px;background:#fff;color:#15181c;-webkit-user-select:all;user-select:all}",
    "#ss-okuru-find{margin:0;padding-top:12px;border-top:1px solid #e6e6e3;font-size:13.5px}",
    "#ss-okuru-find b{font-weight:700;white-space:nowrap}",
    "@media print{#ss-okuru{display:none!important}}"
  ].join("");

  function el(tag, attrs, text) {
    var e = document.createElement(tag), k;
    for (k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }

  function build() {
    var st = el("style"); st.textContent = css; document.head.appendChild(st);

    var wrap = el("div", { id: "ss-okuru" });
    var bar = el("button", { type: "button", id: "ss-okuru-bar", "aria-expanded": "false", "aria-controls": "ss-okuru-body" });
    bar.appendChild(el("b", null, "パソコンで使うときは"));
    bar.appendChild(el("span", { "class": "go" }, "このページを自分に送る"));

    var body = el("div", { id: "ss-okuru-body" });
    body.appendChild(el("p", null, "リンクを自分に送っておくと、職員室のパソコンですぐ開けます。"));

    var btns = el("div", { id: "ss-okuru-btns" });
    var msg = el("p", { id: "ss-okuru-msg", role: "status" });
    var url = function () { return location.href; };

    if (navigator.share) {
      var share = el("button", { type: "button", "class": "pri" }, "リンクを自分に送る");
      share.addEventListener("click", function () {
        bump("cta:okuru-share");
        navigator.share({ title: document.title, url: url() }).catch(function () {});
      });
      btns.appendChild(share);
    }
    var copy = el("button", { type: "button" }, "リンクをコピーする");
    if (!navigator.share) copy.className = "pri";
    copy.addEventListener("click", function () {
      bump("cta:okuru-copy");
      var p = (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(url()) : Promise.reject();
      p.then(function () { msg.textContent = "リンクをコピーしました。メールやメモに貼って、パソコンで開いてください。"; })
       .catch(function () {
         msg.textContent = "コピーできませんでした。下のリンクを長押しして、コピーしてください。";
         var u = el("span", { id: "ss-okuru-url" }, url());
         msg.appendChild(u);
       });
    });
    btns.appendChild(copy);
    body.appendChild(btns);
    body.appendChild(msg);

    var find = el("p", { id: "ss-okuru-find" });
    find.appendChild(document.createTextNode("パソコンで探すときは、"));
    find.appendChild(el("b", null, "「School Stock 教材」"));
    find.appendChild(document.createTextNode("で検索すると、この棚が出てきます。"));
    body.appendChild(find);

    bar.addEventListener("click", function () {
      var open = wrap.classList.toggle("open");
      bar.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) bump("cta:okuru-open");
    });

    wrap.appendChild(bar);
    wrap.appendChild(body);
    document.body.insertBefore(wrap, document.body.firstChild);
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
