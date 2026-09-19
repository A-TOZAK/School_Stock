/* マス目プリントメーカー：はじめの画面（ひな形を絵で見て選ぶ）と、計算プリントを作る画面
 * index.html では app-panel.js より前に読みこむ（はじめて開いたかどうかを、起動の前に見るため）。
 */
(function () {
  "use strict";
  var App = window.App, h = App.h;
  var firstVisit = !App.loadSaved();

  // ---------- 計算プリントを組む ----------
  var CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  function numLabel(i, style) {
    if (style === "maru" && i < CIRCLED.length) return CIRCLED[i];
    return "（" + (i + 1) + "）";
  }
  function textBlock(x, y, w, size, html, extra) {
    return App.make.text(Object.assign({ x: x, y: y, w: w, h: App.lineH(size, 1), size: size, html: html }, extra || {}));
  }

  /** 式の並びから、問題のページと答えのページを組む。
   *  o = { title, exprs[], paper, orient, cell, cols("auto"か数), answers, num("kakko"|"maru"), zeroStep }
   *  返すのは { doc, skipped[]（筆算にできなかった式）, cols } */
  App.buildKeisan = function (o) {
    o = Object.assign({ title: "計算プリント", exprs: [], paper: "A4", orient: "portrait", cell: 10, cols: "auto", answers: true, num: "kakko", zeroStep: "skip" }, o || {});
    var P = App.PAPER[o.paper] || App.PAPER.A4;
    var pw = o.orient === "landscape" ? P[1] : P[0], ph = o.orient === "landscape" ? P[0] : P[1];
    var m = 12, c = o.cell, gapY = Math.max(8, c * 0.8), numW = 11;
    var items = [], skipped = [];
    o.exprs.forEach(function (src) {
      src = String(src || "").trim();
      if (!src) return;
      var sol = Hissan.solve(src, { zeroStep: o.zeroStep });
      if (!sol.ok) { skipped.push(src); return; }
      items.push({ expr: src, w: sol.cols * c, h: Math.max(sol.rows, sol.reserveRows) * c });
    });
    // 番号のらんの幅は、いちばん長い番号（「（12）」など）が1行におさまる幅にする
    var numChars = items.reduce(function (n, it, i) { return Math.max(n, numLabel(i, o.num).length); }, 1);
    numW = Math.max(11, Math.ceil(numChars * 4.4 + 2.5));
    var maxW = items.reduce(function (a, it) { return Math.max(a, it.w); }, c * 3);
    var usable = pw - m * 2;
    var fit = Math.max(1, Math.floor(usable / (numW + maxW + 6)));
    var cols = o.cols === "auto" ? fit : Math.max(1, Math.min(parseInt(o.cols, 10) || fit, fit));
    var slot = usable / cols;
    var headH = 26;

    function pagesFor(mode) {
      var pages = [], blocks = null, y = 0, i = 0;
      function newPage() {
        blocks = [];
        pages.push({ blocks: blocks });
        var first = pages.length === 1;
        if (first) {
          // 見出しが1行におさまるように、長いときは字を小さくする
          var tt = o.title + (mode === "answer" ? "（こたえ）" : ""), tw = mode === "answer" ? pw - m * 2 : pw - m * 2 - 102;
          var ts = Math.max(10, Math.min(18, Math.floor((tw - 3) / (tt.length * 0.3528 * 1.06))));
          blocks.push(textBlock(m, 10 + (18 - ts) * 0.3, tw, ts, tt, { bold: true }));
          if (mode !== "answer") blocks.push(textBlock(pw - m - 100, 11, 100, 12, "　年　組　名前（　　　　　　　　　　）"));
          blocks.push(App.make.line({ x1: m, y1: 23, x2: pw - m, y2: 23, width: 0.5 }));
        }
        y = first ? headH + 6 : m;
      }
      newPage();
      while (i < items.length) {
        var row = items.slice(i, i + cols);
        var rowH = row.reduce(function (a, it) { return Math.max(a, it.h); }, 0);
        if (y + rowH > ph - m && blocks.length > (pages.length === 1 ? 3 : 0)) newPage();
        row.forEach(function (it, k) {
          var x = m + slot * k;
          blocks.push(textBlock(x, y - 1, numW, 12, numLabel(i + k, o.num)));
          blocks.push(App.make.hissan({ x: Math.ceil((x + numW + 1) * 2) / 2, y: y, expr: it.expr, mode: mode, cell: c, zeroStep: o.zeroStep }));
        });
        y += rowH + gapY;
        i += cols;
      }
      return pages;
    }
    var pages = pagesFor("problem");
    if (o.answers) pages = pages.concat(pagesFor("answer"));
    return {
      doc: { version: 1, title: o.title, paper: o.paper, orient: o.orient, margin: 10, snap: 1, pages: pages },
      skipped: skipped, cols: cols, count: items.length
    };
  };

  // ---------- おまかせの問題 ----------
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  var MAKERS = {
    "tasu2": ["たし算（2けた）", function () { return rnd(12, 89) + "+" + rnd(12, 89); }],
    "tasu3": ["たし算（3けた）", function () { return rnd(105, 899) + "+" + rnd(105, 899); }],
    "hiku2": ["ひき算（2けた）", function () { var a = rnd(31, 99), b = rnd(12, a - 5); return a + "-" + b; }],
    "hiku3": ["ひき算（3けた）", function () { var a = rnd(301, 999), b = rnd(105, a - 15); return a + "-" + b; }],
    "kake21": ["かけ算（2けた×1けた）", function () { return rnd(12, 98) + "×" + rnd(2, 9); }],
    "kake22": ["かけ算（2けた×2けた）", function () { return rnd(12, 98) + "×" + rnd(12, 98); }],
    "kake32": ["かけ算（3けた×2けた）", function () { return rnd(105, 987) + "×" + rnd(12, 98); }],
    "wari21": ["わり算（2けた÷1けた）", function () { return rnd(24, 98) + "÷" + rnd(2, 9); }],
    "wari31": ["わり算（3けた÷1けた）", function () { return rnd(105, 987) + "÷" + rnd(2, 9); }],
    "wari22": ["わり算（2けた÷2けた）", function () { var b = rnd(12, 38); return rnd(b * 2, 99) + "÷" + b; }],
    "wari32": ["わり算（3けた÷2けた）", function () { var b = rnd(12, 78); return rnd(Math.max(105, b * 2), 987) + "÷" + b; }],
    "shosuTasu": ["小数のたし算", function () { return (rnd(11, 98) / 10).toFixed(1) + "+" + (rnd(105, 989) / 100).toFixed(2).replace(/0$/, ""); }],
    "shosuHiku": ["小数のひき算", function () { var a = rnd(51, 98), b = rnd(11, a - 5); return (a / 10).toFixed(1) + "-" + (b / 10).toFixed(1); }]
  };
  App.keisanRandom = function (kind, n) {
    var mk = MAKERS[kind] && MAKERS[kind][1], out = [], seen = {}, guard = 0;
    if (!mk) return out;
    while (out.length < n && guard++ < 400) {
      var e = mk();
      if (seen[e]) continue;
      if (!Hissan.solve(e, {}).ok) continue;
      seen[e] = 1; out.push(e);
    }
    return out;
  };

  // ---------- 画面の部品 ----------
  function closeDialog() { var d = document.getElementById("start-dialog"); if (d) d.remove(); }
  function dialog(title, body, wide) {
    closeDialog();
    var box = h("div", { class: "dlg-box" + (wide ? " wide" : ""), role: "dialog", "aria-label": title },
      h("div", { class: "dlg-head" }, h("b", null, title), h("button", { type: "button", class: "btn ghost", onclick: closeDialog }, "閉じる")),
      body);
    var wrap = h("div", { id: "start-dialog", class: "dlg", onmousedown: function (ev) { if (ev.target === wrap) closeDialog(); } }, box);
    document.body.appendChild(wrap);
    return box;
  }
  function open(doc, fresh) {
    closeDialog();
    if (!App.loadDoc(doc)) return;
    if (fresh) App.resetHistory();
    else App.toast("紙面を置きかえました。「元に戻す」で前の紙面に戻れます。");
  }

  // ---------- 計算プリントを作る画面 ----------
  App.openKeisan = function (fresh) {
    var ta = h("textarea", { class: "ks-exprs", rows: 9, spellcheck: "false", "aria-label": "式を1行に1つずつ" });
    ta.value = ["84÷4", "95÷4", "72÷3", "816÷4", "635÷5", "252÷36"].join("\n");
    var title = h("input", { type: "text", class: "ks-title", value: "わり算の筆算", "aria-label": "プリントの名前" });
    function sel(opts, cur) { var e = h("select"); opts.forEach(function (o) { e.appendChild(h("option", { value: o[0], selected: o[0] === cur }, o[1])); }); return e; }
    var paper = sel([["A4:portrait", "A4 たて"], ["B4:landscape", "B4 よこ"], ["B5:portrait", "B5 たて"], ["A4:landscape", "A4 よこ"]], "A4:portrait");
    var cell = sel([["8", "8 mm"], ["10", "10 mm"], ["12", "12 mm"], ["15", "15 mm"]], "10");
    var cols = sel([["auto", "おまかせ"], ["2", "2問"], ["3", "3問"], ["4", "4問"], ["5", "5問"], ["6", "6問"]], "auto");
    var num = sel([["kakko", "（1）（2）"], ["maru", "① ②"]], "kakko");
    var zero = sel([["skip", "省く"], ["write", "書く"]], "skip");
    var ans = h("input", { type: "checkbox" }); ans.checked = true;
    var kind = sel(Object.keys(MAKERS).map(function (k) { return [k, MAKERS[k][0]]; }), "wari21");
    var count = sel([["6", "6問"], ["9", "9問"], ["12", "12問"], ["16", "16問"], ["20", "20問"]], "12");
    var info = h("p", { class: "hint ks-info" });

    function read() {
      var pp = paper.value.split(":");
      return { title: title.value || "計算プリント", exprs: ta.value.split(/\n/), paper: pp[0], orient: pp[1], cell: parseFloat(cell.value), cols: cols.value, answers: ans.checked, num: num.value, zeroStep: zero.value };
    }
    function refresh() {
      var r = App.buildKeisan(read()), n = r.doc.pages.length, q = ans.checked ? n / 2 : n;
      var msg = r.count + "問。1行に" + r.cols + "問ずつ並びます。問題が" + q + "ページ" + (ans.checked ? "、答えが" + q + "ページ" : "") + "です。";
      if (r.skipped.length) msg += "筆算にできなかった式：" + r.skipped.join("、");
      info.textContent = msg;
      return r;
    }
    [ta, paper, cell, cols, num, zero, ans].forEach(function (e) { e.addEventListener("input", refresh); e.addEventListener("change", refresh); });

    function line(label, control) { return h("label", { class: "ks-row" }, h("span", null, label), control); }
    dialog("計算プリントを作る", h("div", { class: "dlg-body ks" },
      h("div", { class: "ks-cols" },
        h("div", { class: "ks-left" },
          h("p", { class: "ks-lb" }, "式を1行に1つずつ入れます"),
          ta,
          h("p", { class: "hint" }, "たし算（+）、ひき算（-）、かけ算（×）、わり算（÷）の筆算になります。半角の * と / も使えます。小数は、たし算とひき算で使えます。"),
          h("div", { class: "ks-rand" }, kind, count,
            h("button", { type: "button", class: "btn", onclick: function () {
              ta.value = App.keisanRandom(kind.value, parseInt(count.value, 10)).join("\n");
              title.value = MAKERS[kind.value][0].replace(/（.*$/, "") + "の筆算";
              refresh();
            } }, "おまかせで入れる"))),
        h("div", { class: "ks-right" },
          line("プリントの名前", title),
          line("用紙", paper),
          line("マスの大きさ", cell),
          line("1行の問題数", cols),
          line("問題の番号", num),
          line("商に0がたつ段", zero),
          h("label", { class: "chk" }, ans, h("span", null, "答えのページもつける（赤い字）")))),
      info,
      h("div", { class: "dlg-foot" },
        h("p", { class: "hint" }, "作ったあとで、1問ずつ式やマスの大きさを直せます。答えは道具が計算して入れます。"),
        h("button", { type: "button", class: "btn primary", id: "ks-make", onclick: function () {
          var r = refresh();
          if (!r.count) { App.toast("筆算にできる式がありません。"); return; }
          open(r.doc, fresh);
        } }, "このプリントを作る"))), true);
    refresh();
    selectOnFirstFocus(ta);
  };

  /** はじめから入っている例は、入力らんに入ったときに全部を選んでおく（そのまま打てば置きかわる）。 */
  function selectOnFirstFocus(ta) {
    var done = false;
    ta.addEventListener("focus", function () { if (!done) { done = true; setTimeout(function () { ta.select(); }, 0); } });
    ta.addEventListener("input", function () { done = true; });
  }

  // ---------- 漢字練習を作る画面 ----------
  function mkSel(opts, cur) { var e = h("select"); opts.forEach(function (o) { e.appendChild(h("option", { value: o[0], selected: o[0] === cur }, o[1])); }); return e; }
  function mkLine(label, control) { return h("label", { class: "ks-row" }, h("span", null, label), control); }
  App.openKanji = function (fresh) {
    var ta = h("textarea", { class: "ks-exprs", rows: 9, spellcheck: "false", "aria-label": "ことばを1行に1つずつ" });
    ta.value = ["学校 がっこう", "先生 せんせい", "音楽 おんがく", "春 はる", "夏 なつ", "秋 あき", "冬 ふゆ"].join("\n");
    var title = h("input", { type: "text", value: "漢字の練習", "aria-label": "プリントの名前" });
    var paper = mkSel([["A4:portrait", "A4 たて"], ["B4:landscape", "B4 よこ"], ["B5:portrait", "B5 たて"], ["A4:landscape", "A4 よこ"]], "A4:portrait");
    var cell = mkSel([["15", "15 mm"], ["18", "18 mm"], ["20", "20 mm"], ["24", "24 mm"]], "18");
    var nazori = mkSel([["0", "なし（手本だけ）"], ["1", "1回"], ["2", "2回"], ["3", "3回"]], "2");
    var leader = h("input", { type: "checkbox" }); leader.checked = true;
    var info = h("p", { class: "hint ks-info" });
    function read() {
      var pp = paper.value.split(":");
      return { title: title.value || "漢字の練習", words: ta.value.split(/\n/), paper: pp[0], orient: pp[1], cell: parseFloat(cell.value), nazori: parseInt(nazori.value, 10), leader: leader.checked };
    }
    function refresh() {
      var r = App.buildKanji(read());
      info.textContent = r.count + "こ。1ページに" + r.perPage + "列ずつ並びます。全部で" + r.doc.pages.length + "ページです。";
      return r;
    }
    [ta, paper, cell, nazori, leader].forEach(function (e) { e.addEventListener("input", refresh); e.addEventListener("change", refresh); });
    dialog("漢字練習プリントを作る", h("div", { class: "dlg-body ks" },
      h("div", { class: "ks-cols" },
        h("div", { class: "ks-left" },
          h("p", { class: "ks-lb" }, "ことばを1行に1つずつ入れます"),
          ta,
          h("p", { class: "hint" }, "よみがなは、ことばのあとに空白をあけて書きます（例：学校 がっこう）。よみがなは、なくてもかまいません。1行が、たての1列になります。")),
        h("div", { class: "ks-right" },
          mkLine("プリントの名前", title),
          mkLine("用紙", paper),
          mkLine("マスの大きさ", cell),
          mkLine("なぞり書き", nazori),
          h("label", { class: "chk" }, leader, h("span", null, "十字の点線を入れる")))),
      info,
      h("div", { class: "dlg-foot" },
        h("p", { class: "hint" }, "いちばん上が手本、その下がうすい字のなぞり書き、残りが書くマスです。作ったあとで、字や色を直せます。"),
        h("button", { type: "button", class: "btn primary", id: "kj-make", onclick: function () {
          var r = refresh();
          if (!r.count) { App.toast("ことばが入っていません。"); return; }
          open(r.doc, fresh);
        } }, "このプリントを作る"))), true);
    refresh();
    selectOnFirstFocus(ta);
  };

  // ---------- ひな形を絵で見て選ぶ ----------
  function card(name, note, thumb, onPick, cls) {
    var pic = thumb ? h("img", { src: thumb, alt: "", loading: "lazy" }) : h("span", { class: "st-blank" });
    return h("button", { type: "button", class: "st-card " + (cls || ""), onclick: onPick },
      h("span", { class: "st-thumb" }, pic), h("span", { class: "st-name" }, name), note ? h("span", { class: "st-note" }, note) : null);
  }
  App.openStart = function (fresh) {
    var body = h("div", { class: "dlg-body st" });
    if (fresh) body.appendChild(h("p", { class: "st-lead" }, "どれから始めますか。あとから、上の「テンプレート」で、いつでも選びなおせます。"));

    var notes = App.NOTE_SHEETS || [];
    if (notes.length) {
      body.appendChild(h("h3", null, "ノート"));
      var g0 = h("div", { class: "st-grid" });
      notes.forEach(function (s) {
        g0.appendChild(card(s.name, s.note, "assets/tpl/note-" + s.key + ".webp", function () { open(App.noteDoc(s), fresh); }));
      });
      body.appendChild(g0);
    }

    body.appendChild(h("h3", null, "問題を入れて作る"));
    body.appendChild(h("div", { class: "st-grid" },
      card("計算プリントを作る", "式を入れると、筆算が並びます。答えのページもできます。", "assets/tpl/keisan.webp", function () { App.openKeisan(fresh); }, "make"),
      card("漢字練習プリントを作る", "ことばを入れると、手本、なぞり書き、書くマスが並びます。", "assets/tpl/kanji.webp", function () { App.openKanji(fresh); }, "make")));

    body.appendChild(h("h3", null, "テンプレート"));
    var g1 = h("div", { class: "st-grid" });
    Object.keys(App.templates).forEach(function (k) {
      if (k === "hissan6") return;   // 「計算プリントを作る」と同じものなので、ここには出さない
      var t = App.templates[k];
      g1.appendChild(card(t.name, t.note || "", /^blank/.test(k) ? null : "assets/tpl/" + k + ".webp", function () { open(t.build(), fresh); }, /^blank/.test(k) ? "blank" : ""));
    });
    body.appendChild(g1);

    var ex = window.MASUME_EXAMPLES || [];
    if (ex.length) {
      body.appendChild(h("h3", null, "教科の事例"));
      var g2 = h("div", { class: "st-grid" });
      ex.forEach(function (e) {
        g2.appendChild(card(e.name, (e.paper || "") + (e.pages > 1 ? "、" + e.pages + "ページ" : ""), "examples/thumb/" + e.key + "_p1.webp", function () { open(e.doc, fresh); }));
      });
      body.appendChild(g2);
    }
    dialog("テンプレート", body, true);
  };

  // ---------- 選んだ部品のすぐ上に出る小さなバー ----------
  var drawSel = App.drawSelection;
  App.drawSelection = function () {
    drawSel.apply(App, arguments);
    document.querySelectorAll(".float-bar").forEach(function (n) { n.remove(); });
    var f = App.selId ? App.find(App.selId) : null, page = f && App.pageEl(f.page);
    if (!f || !page || App.dragging) return;
    var r = App.bbox(f.block), id = f.block.id, k = 1 / (App.scale || 1);
    function b(label, fn, cls) {
      return h("button", { type: "button", class: cls || "", title: label, onmousedown: function (ev) { ev.preventDefault(); ev.stopPropagation(); },
        onpointerdown: function (ev) { ev.stopPropagation(); }, onclick: function (ev) { ev.stopPropagation(); fn(); } }, App.uiIcon(label, 16), h("span", null, label));
    }
    var bar = h("div", { class: "float-bar no-print", onpointerdown: function (ev) { ev.stopPropagation(); }, onmousedown: function (ev) { ev.preventDefault(); ev.stopPropagation(); } },
      b("複製", function () { App.duplicate(id); }),
      b("前面へ", function () { App.reorder(id, "front"); }),
      b("背面へ", function () { App.reorder(id, "back"); }),
      h("span", { class: "sep" }),
      b("削除", function () { App.removeBlock(id); }, "danger"));
    // 部品の右上に、右はしをそろえて置く。紙の上はしに近いときは、部品の下に出す
    // つまみ（部品の左上の札）と重ならないように、札の高さ（画面で26px）だけ上に上げる
    var lift = 26 * k, above = r.y > 17 * k;
// 右はしをそろえて置く。紙の左はしに近くてバーが紙の外（左の道具の裏）に出るときは、左はしをそろえる
    var barMm = 270 * k * 0.2646, leftAlign = r.x + r.w - barMm < 0;
    bar.style.cssText = "left:" + (leftAlign ? Math.max(0, r.x) : r.x + r.w) + "mm;top:" + (above ? r.y : r.y + r.h) + "mm;transform:translate(" + (leftAlign ? "0" : "-100%") + "," + (above ? "-100%" : "0") + ") scale(" + k + ");transform-origin:" + (leftAlign ? "left " : "right ") + (above ? "bottom" : "top") + ";margin-top:" + (above ? -(lift + 3 * k) + "px" : 6 * k + "px");
    page.appendChild(bar);
  };

  // ---------- つなぐ ----------
  document.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t && t.id === "tpl" && t.value === "gallery") { t.value = ""; ev.stopPropagation(); App.openStart(false); }
  }, true);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && document.getElementById("start-dialog")) { ev.stopPropagation(); closeDialog(); }
  }, true);
  window.addEventListener("load", function () {
    var bt = App.$("#btn-tpl");
    if (bt) bt.addEventListener("click", function () { App.openStart(false); });
    var q = new URLSearchParams(location.search);
    if (firstVisit && !q.get("t") && q.get("e") === null && !q.get("src")) App.openStart(true);
  });
})();
