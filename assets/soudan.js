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

  /* ── 計器（2026-08-11）──────────────────────────────
   * 相談窓口のボタンが押されたかどうかを数える。これまで1件も数えていなかったので、
   * 「クリック率が上がった」を言える土台がなかった。数えるのは次の4つだけ。
   *
   *   cta:soudan-click            押された回数（合計）
   *   cta:soudan-click:btn        ふつうのボタンから
   *   cta:soudan-click:mini       ×で小さくしたあと、また押した（＝戻ってきた人）
   *   cta:soudan-from:<棚>        どの棚から押されたか（prints / sozai / shien …）
   *   cta:soudan-close            ×で小さくされた回数（じゃまになっていないかの目安）
   *
   * 貯めるのは回数だけ。個人を追う値は一切送らない。
   * counter.js が設定されていないとき（ローカル確認など）は何も起きない。
   */
  function track(what) {
    try { if (window.SS_BUMP) window.SS_BUMP(what); } catch (e) {}
  }

  // /School_Stock/prints/kokugo/ → "prints"、トップは "top"
  function shelf() {
    try {
      var m = location.pathname.match(/\/School_Stock\/([^\/]+)\//);
      return m ? decodeURIComponent(m[1]) : "top";
    } catch (e) { return "top"; }
  }

  var css = [
    /* 位置：下端から離す。iOSはセーフエリア（ホームバー・Safari下部バー）ぶんを足す */
    ":root{--ss-b: calc(28px + env(safe-area-inset-bottom, 0px));}",
    "#ss-soudan-btn{position:fixed;right:20px;bottom:var(--ss-b);z-index:9990;display:flex;align-items:center;gap:9px;",
    "background:#15181c;color:#fff;border-radius:999px;padding:7px 18px 7px 8px;",
    "font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;",
    "font-size:13px;line-height:1;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.22);",
    "transition:transform .15s ease, box-shadow .15s ease;}",
    "#ss-soudan-btn:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,0,0,.28);}",
    "#ss-soudan-btn:active{transform:scale(.97);}",
    "#ss-soudan-btn .ss-av{width:34px;height:34px;border-radius:50%;background:#fff;display:block;}",
    "#ss-soudan-close{position:fixed;z-index:9991;cursor:pointer;border:none;",
    "right:12px;bottom:calc(var(--ss-b) + 42px);width:20px;height:20px;border-radius:50%;",
    "background:#e6e6e3;color:#6b7077;font-size:11px;line-height:20px;text-align:center;padding:0;}",
    "#ss-soudan-mini{position:fixed;right:20px;bottom:var(--ss-b);z-index:9990;display:none;",
    "width:48px;height:48px;border-radius:50%;background:#fff;border:2px solid #15181c;",
    "box-shadow:0 4px 14px rgba(0,0,0,.22);overflow:hidden;}",
    "#ss-soudan-mini img{width:100%;height:100%;display:block;}",
    "@media (max-width:600px){:root{--ss-b: calc(34px + env(safe-area-inset-bottom, 0px));}",
    "#ss-soudan-btn{padding:6px 14px 6px 7px;font-size:12px;right:14px;}",
    "#ss-soudan-btn .ss-av{width:30px;height:30px;}#ss-soudan-mini{right:14px;}}",
    /* 動き：既定は動かさない（reduced-motion優先）。動かせる環境だけ、登場フェード＋1回だけの会釈 */
    "@media (prefers-reduced-motion: no-preference){",
    "#ss-soudan-btn.ss-enter{opacity:0;transform:translateY(10px) scale(.96);}",
    "#ss-soudan-btn.ss-in{opacity:1;transform:none;transition:opacity .32s ease-out,transform .32s ease-out,box-shadow .15s ease;}",
    "@keyframes ss-nod{0%,100%{transform:rotate(0)}30%{transform:rotate(-7deg)}60%{transform:rotate(5deg)}}",
    "#ss-soudan-btn .ss-av.ss-nod{animation:ss-nod .5s ease-in-out 1;}}",
    "@media print{#ss-soudan-btn,#ss-soudan-close,#ss-soudan-mini{display:none !important;}}"
  ].join("");

  /* ── お礼カード（2026-08-11）──────────────────────────────
   * 教材をダウンロードしたあと、相談窓口ボタンの上に小さなカードを出す。
   * 絵は10種。ふだんは9種から1枚、50回に1回だけ牛（UFOに連れていかれる）が出る。
   * 絵と文は組で固定。ランダムに組み合わせない。
   *
   * 出しかたの作法
   *   - ダウンロードのたびに毎回出す（2026-08-11 本人指示。回数の上限は設けない）
   *   - 1枚目はフルサイズ12秒。2枚目からは小さめ・6秒・お礼だけ（CTAなし）
   *     ＝まとめて落とす人の邪魔をしない（同日夜のレビュー盤 判断A）
   *   - ただしレア（牛）はいつでもフルサイズ12秒
   *   - ×で消しても、次にダウンロードすればまた出る。ただし×を同じ日に2回押したら
   *     その日はもう出さない（「もういい」の意思表示を尊重する）
   *   - 続けて同じ絵は出さない（毎回ちがう絵が出るのが、この仕掛けの主旨）
   *   - ボタンを×で小さくしている人には出さない
   *   - 動きを減らす設定の環境では、動かさず静かに出す
   *   - 画像は出るときに1枚だけ読む（先読みしない。1枚6KB）
   *   - 貯めるのは表示回数と日付だけ。個人を追う値は使わない
   */
  var OREI = [
    { id: "sensei_f",     img: "01_sensei_f.webp",     msg: "明日の授業が、また楽しみになりますように" },
    { id: "sensei_m",     img: "02_sensei_m.webp",     msg: "今日は、少し早く帰れますように" },
    { id: "sensei_senior",img: "03_sensei_senior.webp",msg: "準備が、少し軽くなりますように" },
    { id: "sensei_new",   img: "04_sensei_new.webp",   msg: "うまくいくと、いいですね" },
    { id: "neko",         img: "05_neko.webp",         msg: "またどうぞ。棚は増えていきます" },
    { id: "inu",          img: "06_inu.webp",          msg: "どうぞ、持っていってください" },
    { id: "kapibara",     img: "07_kapibara.webp",     msg: "ゆっくり休める夜になりますように" },
    { id: "usagi",        img: "08_usagi.webp",        msg: "教室で、うまく回りますように" },
    { id: "hamster",      img: "09_hamster.webp",      msg: "印刷、うまくいきますように" }
  ];
  var OREI_RARE = { id: "ushi", img: "10_ushi.webp", msg: "行ってきます" };
  var OREI_RARE_RATE = 0.02;   // 50回に1回
  var OREI_SHOW_MS = 12000;         // 1枚目。見えているあいだだけ数える
  var OREI_SHOW_MS_REPEAT = 6000;   // 2枚目から
  var OREI_DIR = "/School_Stock/assets/orei/";
  var OREI_LAST_KEY = "ss-orei-last";   // 直前に出た絵。続けて同じ絵を出さないためだけに使う
  var OREI_N_KEY = "ss-orei-n";         // このセッションで出した枚数。大きさの切替だけに使う
  var OREI_X_KEY = "ss-orei-x";         // ×を押した日と回数（localStorage）。2回でその日は止める

  function oreiToday() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function oreiMuted() {
    try {
      var v = (localStorage.getItem(OREI_X_KEY) || "").split("|");
      return v[0] === oreiToday() && (parseInt(v[1], 10) || 0) >= 2;
    } catch (e) { return false; }
  }
  function oreiNoteX() {
    try {
      var v = (localStorage.getItem(OREI_X_KEY) || "").split("|");
      var n = (v[0] === oreiToday()) ? (parseInt(v[1], 10) || 0) + 1 : 1;
      localStorage.setItem(OREI_X_KEY, oreiToday() + "|" + n);
    } catch (e) {}
  }

  var oreiCss = [
    "#ss-orei-wrap{position:fixed;right:20px;bottom:calc(var(--ss-b) + 60px);z-index:9992;",
    "width:260px;max-width:78vw;display:none;}",
    "#ss-orei{display:block;background:#fff;border-radius:14px;overflow:hidden;",
    "box-shadow:0 8px 30px rgba(0,0,0,.20);text-decoration:none;color:#15181c;",
    "font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;}",
    "#ss-orei img{width:100%;height:auto;display:block;background:#fff;}",
    "#ss-orei .ss-orei-msg{padding:12px 14px 4px;font-size:13.5px;line-height:1.7;}",
    "#ss-orei .ss-orei-cta{padding:6px 14px 13px;font-size:12px;color:#6b7077;}",
    "#ss-orei .ss-orei-cta b{color:#15181c;font-weight:600;}",
    "#ss-orei-x{position:absolute;top:-9px;right:-9px;z-index:9993;cursor:pointer;border:none;",
    "width:22px;height:22px;border-radius:50%;padding:0;",
    "background:#e6e6e3;color:#6b7077;font-size:12px;line-height:22px;text-align:center;",
    "box-shadow:0 2px 6px rgba(0,0,0,.18);}",
    "#ss-orei-wrap.ss-orei-small{width:190px;}",
    "#ss-orei-wrap.ss-orei-small .ss-orei-msg{font-size:12px;padding:9px 12px 12px;}",
    /* お礼カードの下の小さな帯（つかってみます・入荷のお知らせ） */
    "#ss-orei-bar{margin-top:8px;background:#fff;border-radius:12px;box-shadow:0 6px 22px rgba(0,0,0,.16);",
    "padding:9px 12px;display:flex;flex-direction:column;gap:6px;}",
    "#ss-orei-rx{border:1.5px solid #15181c;background:#fff;color:#15181c;border-radius:999px;",
    "padding:7px 12px;font-size:12.5px;font-family:inherit;cursor:pointer;line-height:1.4;}",
    "#ss-orei-rx:disabled{border-color:#e6e6e3;color:#3d4148;cursor:default;background:#f6f6f4;}",
    "#ss-orei-news{font-size:11.5px;color:#6b7077;text-decoration:none;text-align:center;}",
    "#ss-orei-news b{color:#15181c;font-weight:600;}",
    "#ss-orei-news:hover{text-decoration:underline;}",
    "@media (max-width:600px){#ss-orei-wrap{right:14px;}}",
    "@media (prefers-reduced-motion: no-preference){",
    "#ss-orei-wrap{opacity:0;transform:translateY(8px) scale(.98);",
    "transition:opacity .28s ease-out, transform .28s ease-out;}",
    "#ss-orei-wrap.ss-orei-in{opacity:1;transform:none;}}",
    "@media print{#ss-orei-wrap{display:none !important;}}"
  ].join("");

  function oreiPick() {
    if (Math.random() < OREI_RARE_RATE) return OREI_RARE;
    var last = null;
    try { last = sessionStorage.getItem(OREI_LAST_KEY); } catch (e) {}
    var pool = OREI;
    if (last) {
      var rest = OREI.filter(function (o) { return o.id !== last; });
      if (rest.length) pool = rest;            // 続けて同じ絵を出さない
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function buildOrei(isMinimized) {
    var style = document.createElement("style");
    style.textContent = oreiCss;
    document.head.appendChild(style);

    var wrap = document.createElement("div");
    wrap.id = "ss-orei-wrap";
    var card = document.createElement("a");
    card.id = "ss-orei";
    card.href = SOUDAN_URL;
    var x = document.createElement("button");
    x.id = "ss-orei-x";
    x.textContent = "×";
    x.title = "閉じる";
    wrap.appendChild(card);
    wrap.appendChild(x);

    /* カードの下の帯（2026-08-11 夜）
     * ・「つかってみます」＝落とした教材ごとに、押された数だけを貯める（rx:＋ファイルの住所）。
     *   文章は書けない。名前も残らない。押した人には「あなたで◯人目」と返す。
     *   掲示板は作らない（検品なしの公開の面を持たない）——声はLINEと相談窓口で1対1のまま。
     * ・「入荷のお知らせ」＝受け取り方をまとめたページへの入り口。名簿は持たない。 */
    var bar = document.createElement("div");
    bar.id = "ss-orei-bar";
    var rx = document.createElement("button");
    rx.id = "ss-orei-rx";
    rx.type = "button";
    rx.textContent = "つかってみます";
    var news = document.createElement("a");
    news.id = "ss-orei-news";
    news.href = "/School_Stock/oshirase/";
    news.innerHTML = "新しい教材が入ったら知りたい方は <b>こちら →</b>";
    bar.appendChild(rx);
    bar.appendChild(news);
    wrap.appendChild(bar);
    document.body.appendChild(wrap);

    var lastDlKey = "";   // 直前に落とされたファイル。リアクションの宛先になる

    function rxDone(n) {
      rx.disabled = true;
      rx.textContent = n ? "ありがとうございます。あなたで" + n + "人目です" : "ありがとうございます";
    }
    function rxReset(key) {
      lastDlKey = key || "";
      if (!lastDlKey) { rxDone(0); return; }          // 宛先が取れないときは押せない形で出す
      var seen = false;
      try { seen = !!sessionStorage.getItem("ss-rx-" + lastDlKey); } catch (e) {}
      if (seen) { rxDone(0); return; }                // 同じ教材に2回は数えない
      rx.disabled = false;
      rx.textContent = "つかってみます";
    }
    rx.addEventListener("click", function () {
      if (!lastDlKey || rx.disabled) return;
      var k = "rx:" + lastDlKey;
      try { sessionStorage.setItem("ss-rx-" + lastDlKey, "1"); } catch (e) {}
      rxDone(0);
      startTimer(6000);   // お礼を読む時間だけ延ばして、静かに消える
      // 先に「いま何人目か」を読み、そのあと+1を送る（先に送ると自分の分を二重に数えて見せてしまう）
      var sent = false;
      function send() { if (sent) return; sent = true; track(k); track("rx-total"); }
      try {
        var CFG = window.SS_COUNTER || {};
        if (!CFG.url || !CFG.key) { send(); return; }
        fetch(CFG.url + "/rest/v1/counts?select=n&key=eq." + encodeURIComponent(k), {
          headers: { "apikey": CFG.key, "Authorization": "Bearer " + CFG.key }
        }).then(function (r) { return r.json(); }).then(function (rows) {
          var n = (rows && rows[0] && rows[0].n) || 0;
          rxDone(n + 1);
          send();
        }).catch(send);
        setTimeout(send, 2500);   // 読みが遅くても+1だけは必ず送る
      } catch (e) { send(); }
    });
    news.addEventListener("click", function () {
      track("cta:oshirase-click");
      track("cta:oshirase-from:" + shelf());
    });

    /* 消えるまでの8秒は「見えているあいだ」だけ数える（2026-08-11）
     * PDFが別タブで開くと、このページは裏に回る。ふつうのタイマーだと、
     * 戻ってきたときにはもう消えている（本人指摘「右下のやつが出てこない」）。
     * 裏に回っているあいだは時計を止めて、戻ってきてから数え直す。 */
    var timer = null, remain = 0, startedAt = 0;

    function hide() {
      wrap.style.display = "none";
      wrap.classList.remove("ss-orei-in");
      if (timer) { clearTimeout(timer); timer = null; }
      remain = 0;
    }
    function startTimer(ms) {
      if (timer) { clearTimeout(timer); timer = null; }
      remain = ms;
      if (document.hidden) return;              // 裏にいるあいだは数え始めない
      startedAt = Date.now();
      timer = setTimeout(hide, remain);
    }
    function pauseTimer() {
      if (!timer) return;
      clearTimeout(timer); timer = null;
      remain -= (Date.now() - startedAt);
      if (remain < 0) remain = 0;
    }
    function resumeTimer() {
      if (wrap.style.display !== "block" || timer) return;
      if (remain <= 0) remain = OREI_SHOW_MS;   // 裏で満了していたら、戻ってきてから数え直す
      startedAt = Date.now();
      timer = setTimeout(hide, remain);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pauseTimer(); else resumeTimer();
    });
    x.addEventListener("click", function () { hide(); oreiNoteX(); });
    card.addEventListener("click", function () {
      var id = card.getAttribute("data-orei") || "?";
      track("cta:thanks-click");
      track("cta:thanks-click:" + id);
      track("cta:soudan-from:" + shelf());
    });

    window.addEventListener("ss:download", function (ev) {
      if (isMinimized()) return;                       // 小さくしている人には出さない
      if (oreiMuted()) return;                         // ×を今日2回押した人には出さない

      rxReset(ev && ev.detail && ev.detail.key);       // リアクションの宛先を、いま落とした教材に
      var o = oreiPick();
      var n = 0;
      try { n = parseInt(sessionStorage.getItem(OREI_N_KEY) || "0", 10) || 0; } catch (e) {}
      var compact = n >= 1 && o.id !== OREI_RARE.id;   // 2枚目から小さく。レアはいつでもフルサイズ

      card.setAttribute("data-orei", o.id);
      card.innerHTML =
        '<img src="' + OREI_DIR + o.img + '" alt="" width="520" height="347">' +
        '<div class="ss-orei-msg">' + o.msg + '</div>' +
        (compact ? '' : '<div class="ss-orei-cta">作った本人に、<b>聞けます →</b></div>');
      card.setAttribute("aria-label", o.msg + "。先生の相談窓口を開く");
      wrap.classList[compact ? "add" : "remove"]("ss-orei-small");

      wrap.style.display = "block";
      // 1フレーム置いてからクラスを付ける（付けた瞬間だと動きが出ない）
      setTimeout(function () { wrap.classList.add("ss-orei-in"); }, 20);

      try {
        sessionStorage.setItem(OREI_LAST_KEY, o.id);
        sessionStorage.setItem(OREI_N_KEY, String(n + 1));
      } catch (e) {}

      track("cta:thanks-shown");
      track("cta:thanks-shown:" + o.id);

      startTimer(compact ? OREI_SHOW_MS_REPEAT : OREI_SHOW_MS);
    });
  }

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
    x.addEventListener("click", function () { setMin(true); track("cta:soudan-close"); });
    mini.addEventListener("dblclick", function (e) { e.preventDefault(); setMin(false); });

    // 計器：押されたら数える。ページが切り替わっても keepalive で届く（counter.js 側）
    function counted(where) {
      return function () {
        track("cta:soudan-click");
        track("cta:soudan-click:" + where);
        track("cta:soudan-from:" + shelf());
      };
    }
    a.addEventListener("click", counted("btn"));
    mini.addEventListener("click", counted("mini"));

    var saved = "0";
    try { saved = sessionStorage.getItem(KEY) || "0"; } catch (e) {}
    if (saved === "1") setMin(true);

    // 登場（フェード）と、3.5秒後に1回だけの会釈。reduced-motion環境ではCSS側で無効
    if (saved !== "1") {
      a.classList.add("ss-enter");
      setTimeout(function () { a.classList.add("ss-in"); }, 400);
      setTimeout(function () { a.classList.remove("ss-enter", "ss-in"); }, 1400);
      setTimeout(function () {
        var av = a.querySelector(".ss-av");
        if (av) av.classList.add("ss-nod");
      }, 3500);
    }

    buildOrei(function () {
      try { return sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
