/* マス目プリントメーカー：書体
 * 1) 教科書体がパソコンに入っていないときの逃げ道（同梱の Klee One）
 * 2) いま実際に使われている字を調べて、設定らんに出す
 * 3) パソコンの中のフォントから選ぶ（Chrome と Edge）。だめなときはフォントのファイルを選ぶ
 *
 * 部品の font には、決まった4つの名前（kyokasho など）か、"local:フォント名" が入る。
 * フォントの中身は紙面のファイルに入れない。名前だけを持つ。
 */
(function () {
  "use strict";
  var App = window.App, h = App.h;
  var STORE = "masume-print.fonts.v1";

  // 教科書体として探す順。画面に出す名前つき
  var KYOKASHO = [
    ["UDデジタル教科書体", ["UDデジタル教科書体 ProN", "UDDigiKyokasho ProN", "UD デジタル 教科書体 N-R", "UD Digi Kyokasho N-R", "UDデジタル教科書体 StdN", "UD デジタル 教科書体 NK-R", "UD デジタル 教科書体 NP-R"]],
    ["游教科書体", ["游教科書体 New", "YuKyokasho", "游教科書体", "YuKyokasho Yoko"]],
    ["Klee One（この道具に入っている教科書体ふうの字）", ["Klee One"]]
  ];

  /** 部品の font から、CSS の font-family を作る。 */
  App.fontCss = function (key) {
    if (App.FONTS[key]) return App.FONTS[key];
    var name = App.localFontName(key);
    if (name) return '"' + name.replace(/["\\]/g, "") + '",' + App.FONTS.kyokasho;
    return App.FONTS.kyokasho;
  };
  App.localFontName = function (key) {
    return typeof key === "string" && key.indexOf("local:") === 0 ? key.slice(6) : "";
  };

  // ---------- 入っているかどうかを調べる ----------
  var cv = null;
  function width(family, base) {
    if (!cv) cv = document.createElement("canvas").getContext("2d");
    cv.font = "72px " + (family ? '"' + family + '",' : "") + base;
    return cv.measureText("mmwwiiMW10Ag@あ永").width;
  }
  /** その名前のフォントが、このパソコン（か、この道具）で使えるか。 */
  App.hasFont = function (family) {
    if (family === "Klee One") {
      try { return document.fonts.check('16px "Klee One"'); } catch (e) { return false; }
    }
    return ["monospace", "serif", "sans-serif"].some(function (base) {
      return Math.abs(width(family, base) - width("", base)) > 0.5;
    });
  };
  /** 教科書体として、いま実際に使われている字。{name, rank} rank 0=UD、1=游、2=Klee、3=どれもない */
  App.kyokashoInUse = function () {
    for (var i = 0; i < KYOKASHO.length; i++) {
      if (KYOKASHO[i][1].some(App.hasFont)) return { name: KYOKASHO[i][0], rank: i };
    }
    return { name: "丸ゴシック体", rank: 3 };
  };

  // ---------- 自分で選んだフォントの一覧（このブラウザに覚えておく） ----------
  App.myFonts = function () {
    try { return JSON.parse(localStorage.getItem(STORE) || "[]").filter(function (x) { return typeof x === "string"; }); } catch (e) { return []; }
  };
  function remember(name) {
    var list = App.myFonts().filter(function (x) { return x !== name; });
    list.unshift(name);
    try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 12))); } catch (e) { /* 覚えられなくても使える */ }
  }

  /** 書体の選択らんに出す項目。決まった4つ＋自分で選んだもの＋この部品のもの。 */
  App.fontOptions = function (current) {
    var opts = App.FONT_NAMES.slice(), seen = {};
    var names = App.myFonts();
    var cur = App.localFontName(current);
    if (cur) names.unshift(cur);
    names.forEach(function (n) {
      if (seen[n]) return;
      seen[n] = 1;
      opts.push(["local:" + n, n + (App.hasFont(n) ? "" : "（このパソコンにありません）")]);
    });
    opts.push(["__pick", "パソコンの中のフォントから選ぶ…"]);
    return opts;
  };

  // ---------- 選ぶ画面 ----------
  var cache = null;
  function closeDialog() {
    var d = document.getElementById("font-dialog");
    if (d) d.remove();
  }
  function dialog(title, body) {
    closeDialog();
    var box = h("div", { class: "dlg-box", role: "dialog", "aria-label": title },
      h("div", { class: "dlg-head" }, h("b", null, title),
        h("button", { type: "button", class: "btn ghost", onclick: closeDialog }, "閉じる")),
      body);
    var wrap = h("div", { id: "font-dialog", class: "dlg", onmousedown: function (ev) { if (ev.target === wrap) closeDialog(); } }, box);
    document.body.appendChild(wrap);
    return box;
  }

  /** フォントのファイルを選んで使う。パソコンの中を見られないブラウザのための入口。 */
  function pickFile(done) {
    var inp = App.$("#file-font");
    inp.value = "";
    inp.onchange = function () {
      var file = inp.files && inp.files[0];
      if (!file) return;
      var name = file.name.replace(/\.[^.]+$/, "");
      file.arrayBuffer().then(function (buf) {
        var face = new FontFace(name, buf);
        return face.load().then(function () {
          document.fonts.add(face);
          closeDialog();
          done(name, true);
        });
      }).catch(function () { App.toast("このファイルは、フォントとして読めませんでした。"); });
    };
    inp.click();
  }

  function fileRow(done, note) {
    return h("div", { class: "dlg-foot" },
      h("p", { class: "hint" }, note),
      h("button", { type: "button", class: "btn", onclick: function () { pickFile(done); } }, "フォントのファイルを選ぶ"));
  }

  function showList(families, done) {
    var filter = h("input", { type: "search", class: "dlg-filter", placeholder: "名前でしぼる（例：教科書、UD、明朝）", "aria-label": "フォントの名前でしぼる" });
    var onlyJa = h("input", { type: "checkbox" });
    onlyJa.checked = true;
    var list = h("div", { class: "dlg-list" });
    var count = h("span", { class: "dlg-count" });
    function draw() {
      var q = filter.value.trim().toLowerCase();
      list.innerHTML = "";
      var hit = families.filter(function (f) {
        if (onlyJa.checked && !f.ja) return false;
        return !q || f.name.toLowerCase().indexOf(q) >= 0;
      });
      count.textContent = hit.length + "件";
      hit.slice(0, 300).forEach(function (f) {
        list.appendChild(h("button", { type: "button", class: "dlg-item", onclick: function () { closeDialog(); done(f.name, false); } },
          h("span", { class: "fn" }, f.name),
          h("span", { class: "fs", style: 'font-family:"' + f.name.replace(/["\\]/g, "") + '"' }, "あいうえお 学校 山川 123")));
      });
      if (!hit.length) list.appendChild(h("p", { class: "hint" }, "あてはまるフォントがありません。「日本語のフォントだけ」を外すと、すべて出ます。"));
    }
    filter.addEventListener("input", draw);
    onlyJa.addEventListener("change", draw);
    var box = dialog("パソコンの中のフォントから選ぶ",
      h("div", { class: "dlg-body" },
        h("div", { class: "dlg-tools" }, filter, h("label", { class: "chk" }, onlyJa, h("span", null, "日本語のフォントだけ")), count),
        list,
        fileRow(done, "一覧にないフォントは、ファイル（.ttf / .otf）を選んで使えます。")));
    draw();
    filter.focus();
    return box;
  }

  // 日本語のフォントらしい名前
  var JA = /[ぁ-んァ-ヶ一-龠]|gothic|mincho|kyokasho|hiragino|yu ?go|yu ?min|meiryo|biz ?ud|uddigi|noto (sans|serif) (cjk )?jp|klee|kosugi|zen |tsuku|osaka|ipa|morisawa|ud shin|shin go|ryumin|maru/i;

  /** パソコンの中のフォントを選ぶ。done(フォント名, ファイルから入れたか) */
  App.pickLocalFont = function (done) {
    function finish(name, fromFile) {
      remember(name);
      done(name);
      if (fromFile) App.toast("「" + name + "」を入れました。ファイルから入れた字は、この画面を閉じるまで使えます。");
    }
    if (!window.queryLocalFonts) {
      dialog("フォントのファイルを選ぶ", h("div", { class: "dlg-body" },
        fileRow(finish, "このブラウザは、パソコンの中のフォントの一覧を出せません。Chrome か Edge で開くと、一覧から選べます。ここでは、フォントのファイル（.ttf / .otf）を選んで使えます。")));
      return;
    }
    if (cache) { showList(cache, finish); return; }
    window.queryLocalFonts().then(function (fonts) {
      var seen = {}, out = [];
      fonts.forEach(function (f) {
        if (seen[f.family]) return;
        seen[f.family] = 1;
        out.push({ name: f.family, ja: JA.test(f.family) || JA.test(f.fullName || "") });
      });
      out.sort(function (a, b) { return a.name.localeCompare(b.name, "ja"); });
      if (!out.length) throw new Error("none");
      cache = out;
      showList(out, finish);
    }).catch(function () {
      dialog("フォントのファイルを選ぶ", h("div", { class: "dlg-body" },
        fileRow(finish, "パソコンの中のフォントを見る許可が出ませんでした。学校のパソコンでは、設定で止められていることがあります。かわりに、フォントのファイル（.ttf / .otf）を選んで使えます。")));
    });
  };

  // ---------- 紙面を開いたときの知らせ ----------
  /** 紙面で使われているのに、このパソコンにないフォントの名前。 */
  App.missingFonts = function (doc) {
    var seen = {}, out = [];
    ((doc || App.doc).pages || []).forEach(function (pg) {
      (pg.blocks || []).forEach(function (b) {
        var n = App.localFontName(b.font);
        if (n && !seen[n]) { seen[n] = 1; if (!App.hasFont(n)) out.push(n); }
      });
    });
    return out;
  };
  App.warnMissingFonts = function () {
    var miss = App.missingFonts();
    if (!miss.length) return false;
    App.toast("このプリントは「" + miss.join("」「") + "」で作られています。このパソコンには入っていないので、教科書体で表示しています。", 7000);
    return true;
  };

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && document.getElementById("font-dialog")) { ev.stopPropagation(); closeDialog(); }
  }, true);
})();
