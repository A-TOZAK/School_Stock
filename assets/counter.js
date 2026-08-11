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

  // ほかのスクリプト（soudan.js など）からも1回だけ数えられるように出しておく。
  // 設定が入っていないときは、この行まで来ないので undefined のまま＝呼んでも何も起きない。
  window.SS_BUMP = bump;

  // ページの住所（/.../index.html → /.../ に正規化）
  function pagePath() {
    var p = location.pathname.replace(/index\.html$/, "");
    return decode(p) || "/";
  }

  // 日本語のファイル名が %E5%B9%B4… のまま貯まると集計で読めないので戻す
  function decode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
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
    // 押された瞬間にも別タブ指定を入れる。あとからJSで並べ直す棚（素材ライブラリ等）は
    // 読み込み時の一括処理に間に合わないので、ここで拾う
    if (!a.hasAttribute("download") && !a.getAttribute("target") &&
        /\.(pdf|zip)(\?|#|$)/i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
    }
    // あとからJSで注入されたリンク（施錠ページ等）もクリック時に配信リポジトリへ向ける
    try {
      var ru = new URL(href, location.href);
      if (location.hostname.indexOf("github.io") !== -1 &&
          ru.origin === location.origin &&
          ru.pathname.indexOf("/School_Stock/") === 0 &&
          /\.(pdf|zip)$/i.test(ru.pathname)) {
        href = ru.pathname.replace("/School_Stock/", "/School_Stock_files/") + ru.search + ru.hash;
        a.setAttribute("href", href);
      }
    } catch (e) { /* 触らない */ }
    var key = href;
    try { key = decode(new URL(href, location.href).pathname); } catch (e) {}
    // 配布ファイルは School_Stock_files リポジトリから配信するが（2026-08-10 容量分離）、
    // 計測キーは従来どおり /School_Stock/… に揃えて過去データと連続させる
    key = key.replace(/^\/School_Stock_files\//, "/School_Stock/");
    bump("dl:" + key);

    // ダウンロードされたことを、ほかのスクリプト（soudan.js のお礼カード）へ知らせる。
    // 計測とは別物なので、失敗しても計測もダウンロードも止めない。
    try {
      window.dispatchEvent(new CustomEvent("ss:download", { detail: { key: key } }));
    } catch (e) {}
  }, true);

  // ── 配布ファイルのリンクを配信リポジトリへ向ける（2026-08-10 容量分離） ──
  // 新しく作ったページが従来どおり相対パスで PDF/ZIP を指していても、
  // 実体のある /School_Stock_files/ へ張り替える。既に張り替え済みのリンクは触らない。
  // ── PDF・ZIPは別タブで開く（2026-08-11）────────────────────
  // 棚によってリンクの書き方が3通りに割れていた：ただのリンク（国語）／target=_blank（支援）／
  // download（算数）。ただのリンクだと同じタブでPDFが開き、棚のページごと消える。
  // 見ていたページが消えるのは棚として不便だし、お礼カードも出る間がない。
  // download属性のあるものは触らない（あれは本当に落ちるリンクなので、ページは消えない）。
  function openInNewTab() {
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.hasAttribute("download")) continue;
      if (a.getAttribute("target")) continue;
      var href = a.getAttribute("href") || "";
      if (!/\.(pdf|zip)(\?|#|$)/i.test(href)) continue;
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
    }
  }

  function retargetFiles() {
    if (location.hostname.indexOf("github.io") === -1) return; // ローカル確認では何もしない
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute("href") || "";
      if (!/\.(pdf|zip)(\?|#|$)/i.test(href)) continue;
      try {
        var u = new URL(href, location.href);
        if (u.origin !== location.origin) continue;
        if (u.pathname.indexOf("/School_Stock/") !== 0) continue;
        a.setAttribute("href", u.pathname.replace("/School_Stock/", "/School_Stock_files/") + u.search + u.hash);
      } catch (e) { /* 触らない */ }
    }
  }
  function prepLinks() { retargetFiles(); openInNewTab(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", prepLinks);
  } else {
    prepLinks();
  }
  // あとからJSで並べ直す棚（素材ライブラリ・プリント一覧）にも効かせる
  window.addEventListener("load", prepLinks);
})();
