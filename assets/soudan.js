/* School Stock 相談窓口ボタン
 * - 全ページの右下に「先生の相談窓口」ボタンを出す
 * - 相談ページ（/School_Stock/soudan/）自身では出さない
 * - ×で小さくできる（そのタブの間だけ記憶・クッキー不使用）
 * - 印刷時は消える
 */
(function () {
  "use strict";
  if (document.getElementById("ss-soudan-btn")) return;
  if (location.pathname.indexOf("/soudan/") !== -1) return;

  var SOUDAN_URL = "/School_Stock/soudan/";
  var KEY = "ss-soudan-min";

  var css = [
    "#ss-soudan-btn{position:fixed;right:16px;bottom:16px;z-index:9990;display:flex;align-items:center;gap:9px;",
    "background:#15181c;color:#fff;border-radius:999px;padding:7px 18px 7px 8px;",
    "font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;",
    "font-size:13px;line-height:1;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.22);",
    "transition:transform .15s ease, box-shadow .15s ease;}",
    "#ss-soudan-btn:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,0,0,.28);}",
    "#ss-soudan-btn .ss-av{width:34px;height:34px;border-radius:50%;background:#fff;",
    "object-fit:cover;object-position:60% 22%;display:block;}",
    "#ss-soudan-close{position:fixed;z-index:9991;cursor:pointer;border:none;",
    "right:8px;bottom:56px;width:20px;height:20px;border-radius:50%;",
    "background:#e6e6e3;color:#6b7077;font-size:11px;line-height:20px;text-align:center;padding:0;}",
    "#ss-soudan-mini{position:fixed;right:16px;bottom:16px;z-index:9990;display:none;",
    "width:48px;height:48px;border-radius:50%;background:#fff;border:2px solid #15181c;",
    "box-shadow:0 4px 14px rgba(0,0,0,.22);overflow:hidden;}",
    "#ss-soudan-mini img{width:100%;height:100%;object-fit:cover;object-position:60% 22%;display:block;}",
    "@media (max-width:600px){#ss-soudan-btn{padding:6px 14px 6px 7px;font-size:12px;right:12px;bottom:12px;}#ss-soudan-btn .ss-av{width:30px;height:30px;}}",
    "@media print{#ss-soudan-btn,#ss-soudan-close,#ss-soudan-mini{display:none !important;}}"
  ].join("");

  function build() {
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var a = document.createElement("a");
    a.id = "ss-soudan-btn";
    a.href = SOUDAN_URL;
    a.innerHTML = '<img class="ss-av" src="/School_Stock/assets/soudan_icon.png" alt=""><span>先生の相談窓口</span>';
    a.setAttribute("aria-label", "先生の相談窓口（無料）を開く");

    var x = document.createElement("button");
    x.id = "ss-soudan-close";
    x.textContent = "×";
    x.title = "小さくする";

    var mini = document.createElement("a");
    mini.id = "ss-soudan-mini";
    mini.href = SOUDAN_URL;
    mini.innerHTML = '<img src="/School_Stock/assets/soudan_icon.png" alt="先生の相談窓口">';
    mini.title = "先生の相談窓口";

    document.body.appendChild(a);
    document.body.appendChild(x);
    document.body.appendChild(mini);

    function setMin(min) {
      a.style.display = min ? "none" : "flex";
      x.style.display = min ? "none" : "block";
      mini.style.display = min ? "block" : "none";
      try { sessionStorage.setItem(KEY, min ? "1" : "0"); } catch (e) {}
    }
    x.addEventListener("click", function () { setMin(true); });
    mini.addEventListener("dblclick", function (e) { e.preventDefault(); setMin(false); });

    var saved = "0";
    try { saved = sessionStorage.getItem(KEY) || "0"; } catch (e) {}
    if (saved === "1") setMin(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
