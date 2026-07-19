/* School Stock アクセスカウンター（Supabase）
 * - ページビューと、ダウンロード（download属性 / .pdf / .zip）を1つずつ数える
 * - 外部ライブラリ不要。PostgRESTのRPC(bump)を fetch で叩くだけ
 * - 個人情報・クッキーは使わない。貯めるのは「住所」と「回数」だけ
 * - 同一セッション内の再読込は二重に数えない
 *
 * 設定：Supabaseプロジェクトを作ったら、下の2つを入れる（anon公開キーは公開OK）
 */
(function () {
  "use strict";

  // 設定は assets/counter-config.js（window.SS_COUNTER）から読む。
  // そこに2つの値を貼るだけで計測が始まる。貼るまでは下の guard で何もしない。
  var CFG = (window.SS_COUNTER || {});
  var SUPABASE_URL = CFG.url || "__SUPABASE_URL__";        // 例: https://xxxx.supabase.co
  var SUPABASE_ANON_KEY = CFG.key || "__SUPABASE_ANON_KEY__"; // anon public キー

  // 未設定なら何もしない（誤作動防止）
  if (!SUPABASE_URL || SUPABASE_URL.indexOf("__SUPABASE") === 0) return;
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.indexOf("__SUPABASE") === 0) return;
  if (!("fetch" in window)) return;

  function bump(key) {
    try {
      fetch(SUPABASE_URL + "/rest/v1/rpc/bump", {
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ k: key }),
        keepalive: true   // ダウンロードで画面が切り替わっても送信を守る
      }).catch(function () {});
    } catch (e) { /* 計測はサイトの邪魔をしない */ }
  }

  // ページの住所（/.../index.html → /.../ に正規化）
  function pagePath() {
    var p = location.pathname.replace(/index\.html$/, "");
    return p || "/";
  }

  // ── ページビュー（セッション内の再読込は数えない） ──
  var pvKey = "pv:" + pagePath();
  try {
    if (!sessionStorage.getItem("ss_" + pvKey)) {
      bump(pvKey);
      sessionStorage.setItem("ss_" + pvKey, "1");
    }
  } catch (e) {
    bump(pvKey);
  }

  // ── ダウンロード（download属性 or .pdf/.zip リンクのクリック） ──
  document.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!href) return;
    var isDownload = a.hasAttribute("download") || /\.(pdf|zip)(\?|#|$)/i.test(href);
    if (!isDownload) return;
    var key = href;
    try { key = new URL(href, location.href).pathname; } catch (e) {}
    bump("dl:" + key);
  }, true);
})();
