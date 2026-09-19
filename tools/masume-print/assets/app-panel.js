/* app-panel.js — 左の道具、上のバー、右の設定らん、起動。 */
(function () {
  "use strict";
  var App = window.App, h = App.h, s = App.s, clamp = App.clamp;

  // ---------- 小さな部品 ----------
  function icon(paths) {
    var svg = s("svg", { viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    paths.forEach(function (d) { svg.appendChild(typeof d === "string" ? s("path", { d: d }) : d); });
    return svg;
  }
  var ICONS = {
    masu: ["M4 4h16v16H4z", "M4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16"],
    text: ["M5 6V5h14v1", "M12 5v14", "M9.5 19h5"],
    line: ["M5 19L19 5"],
    arrow: ["M5 19L19 5", "M11 5h8v8"],
    rect: ["M4 6h16v12H4z"],
    ellipse: [s("ellipse", { cx: 12, cy: 12, rx: 8.5, ry: 6.5 })],
    hissan: ["M9 9c1.6 1.6 1.6 6.4 0 8", "M9 9h11", "M4.5 11.5v4", "M13 5v2M17 5v2M13 12v3M17 12v3"],
    shiki: ["M8 5v5M8 14v5", "M5.5 12h5", "M14 9h6M14 15h6"],
    image: ["M4 5h16v14H4z", "M4 16l4.5-4.5 3.5 3.5 3-3 5 5", s("circle", { cx: 9, cy: 9.5, r: 1.4 })],
    name: ["M4 18h16", "M6 14c1.5-5 3-7 4-7s1 3 .5 5 1 2 2 0 1.5-2 2-1 .5 2 1.5 2h2"]
  };

  function group(title) {
    var body = h("div", { class: "grp-body" });
    var g = h("section", { class: "grp" }, title ? h("h3", null, title) : null, body);
    Array.prototype.slice.call(arguments, 1).forEach(function (k) { if (k) body.appendChild(k); });
    return g;
  }
  /** ボタンの名前に合うアイコンがあれば、字の前に置く（絵は app-icons.js）。 */
  function withIcon(label, ctx) {
    var ic = App.uiIcon && App.uiIcon((ctx || "") + label);
    return ic ? [ic, h("span", { class: "bl" }, label)] : [label];
  }
  function row(label, control, note) {
    return h("div", { class: "row", title: note || null }, h("span", { class: "lb" }, label), h("span", { class: "ct" }, control), note ? h("span", { class: "nt" }, note) : null);
  }
  function round2(v) { return Math.round(v * 100) / 100; }

  /** 変更を部品に入れて描きなおす。 */
  function touch(b, key, full) {
    App.refreshBlock(b);
    App.measureAuto();
    App.drawSelection();
    if (App.edit && App.edit.id === b.id) App.drawMasuCaret();
    App.commit(key ? key + ":" + b.id : null);
    if (full) App.renderPanel();
  }

  function num(b, key, o) {
    var inp = h("input", { type: "number", value: round2(b[key]), min: o.min, max: o.max, step: o.step || 1, inputmode: "decimal" });
    inp.addEventListener("input", function () {
      var v = parseFloat(inp.value);
      if (isNaN(v)) return;
      v = clamp(v, o.min, o.max);
      if (o.set) o.set(v); else b[key] = v;
      touch(b, "num-" + key);
    });
    inp.addEventListener("change", function () { inp.value = round2(b[key]); });
    var wrap = h("span", { class: "num" }, inp, o.unit ? h("span", { class: "unit" }, o.unit) : null);
    wrap.input = inp;
    return wrap;
  }
  function chips(values, onPick, fmt) {
    return h("span", { class: "chips" }, values.map(function (v) {
      return h("button", { type: "button", onmousedown: keepFocus, onclick: function () { onPick(v); } }, fmt ? fmt(v) : String(v));
    }));
  }
  function seg(options, current, onPick) {
    var box = h("span", { class: "seg" });
    // 「左・中・右」は字のそろえ。字の大きさの「中」と区別する
    var ctx = options.some(function (o) { return o[1] === "左" || o[1] === "上"; }) ? "そろえ:" : "";
    options.forEach(function (o) {
      var btn = h("button", { type: "button", title: o[1], class: o[0] === current ? "on" : "", onmousedown: keepFocus, onclick: function () {
        box.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
        btn.classList.add("on");
        onPick(o[0]);
      } }, withIcon(o[1], ctx));
      box.appendChild(btn);
    });
    return box;
  }
  function select(options, current, onPick) {
    var el = h("select", { onchange: function () { onPick(el.value); } });
    options.forEach(function (o) { el.appendChild(h("option", { value: o[0], selected: o[0] === current }, o[1])); });
    return el;
  }
  /** 書体の行。決まった4つのほかに、パソコンの中のフォントも選べる。 */
  function fontRow(b) {
    var note = null, name = App.localFontName(b.font);
    if (b.font === "kyokasho") {
      var use = App.kyokashoInUse();
      if (use.rank > 0) note = "いまの字：" + use.name.replace(/（.*$/, "");
    } else if (name && !App.hasFont(name)) note = "このパソコンにないので、教科書体で表示しています。";
    return row("フォント", select(App.fontOptions(b.font), b.font, function (v) {
      if (v === "__pick") {
        App.renderPanel();
        App.pickLocalFont(function (n) { b.font = "local:" + n; touch(b, null, true); });
        return;
      }
      b.font = v; touch(b, null, true);
    }), note);
  }
  function check(label, checked, onToggle) {
    var inp = h("input", { type: "checkbox" });
    inp.checked = !!checked;
    inp.addEventListener("change", function () { onToggle(inp.checked); });
    return h("label", { class: "chk" }, inp, h("span", null, label));
  }
  function swatches(colors, current, onPick) {
    var box = h("span", { class: "sw" });
    colors.forEach(function (c) {
      var btn = h("button", { type: "button", title: c[0], "aria-label": c[0], class: (c[1] === current ? "on " : "") + (c[1] === "none" ? "none" : ""),
        style: c[1] === "none" ? null : "background:" + c[1], onmousedown: keepFocus, onclick: function () {
          box.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
          btn.classList.add("on");
          onPick(c[1]);
        } });
      box.appendChild(btn);
    });
    return box;
  }
  function button(label, onClick, cls) {
    return h("button", { type: "button", class: "btn " + (cls || ""), onmousedown: keepFocus, onclick: onClick }, withIcon(label));
  }
  /** 押しても、打っている場所からフォーカスを動かさない。 */
  function keepFocus(ev) { ev.preventDefault(); }

  // ---------- 右の設定らん ----------
  App.renderPanel = function () {
    var p = App.$("#panel");
    p.innerHTML = "";
    var b = App.selected();
    if (!b) { p.appendChild(docPanel()); return; }
    p.appendChild(h("div", { class: "ptitle" }, App.TYPE_NAMES[b.type]));
    if (b.type === "masu") masuPanel(p, b);
    else if (b.type === "text") textPanel(p, b);
    else if (b.type === "line") linePanel(p, b);
    else if (b.type === "rect") rectPanel(p, b);
    else if (b.type === "hissan") hissanPanel(p, b);
    else if (b.type === "shiki") shikiPanel(p, b);
    else if (b.type === "image") imagePanel(p, b);
    p.appendChild(commonPanel(b));
    foldGroups(p, b.type === "masu" ? ["罫線", "原稿用紙設定"] : []);
  };

  /** 横に長くなりすぎるわくは、押すと下に開く形にたたむ。開いたままの状態は、描きなおしても保つ。 */
  var openFold = null;
  function foldGroups(p, titles) {
    Array.prototype.forEach.call(p.querySelectorAll(".grp"), function (g) {
      var t = g.querySelector("h3"), name = t && t.textContent.trim();
      if (!name || titles.indexOf(name) < 0) return;
      g.classList.add("fold");
      var body = g.querySelector(".grp-body");
      var btn = h("button", { type: "button", class: "fold-btn", "aria-expanded": "false", onmousedown: keepFocus }, App.uiIcon(name, 22), h("span", null, name), h("span", { class: "caret" }, "▾"));
      function place() {
        var r = btn.getBoundingClientRect();
        body.style.left = Math.max(8, Math.min(r.left, window.innerWidth - body.offsetWidth - 8)) + "px";
        body.style.top = (p.getBoundingClientRect().bottom + 2) + "px";
      }
      function set(on) {
        g.classList.toggle("open", on);
        btn.setAttribute("aria-expanded", on ? "true" : "false");
        if (on) { openFold = name; place(); } else if (openFold === name) openFold = null;
      }
      btn.addEventListener("click", function () {
        var on = !g.classList.contains("open");
        Array.prototype.forEach.call(p.querySelectorAll(".grp.fold.open"), function (o) { o.classList.remove("open"); });
        openFold = null;
        set(on);
      });
      g.insertBefore(btn, body);
      if (openFold === name) set(true);
    });
  }
  document.addEventListener("pointerdown", function (ev) {
    if (!openFold || (ev.target.closest && ev.target.closest(".grp.fold"))) return;
    openFold = null;
    Array.prototype.forEach.call(document.querySelectorAll(".grp.fold.open"), function (o) { o.classList.remove("open"); });
  }, true);

  function docPanel() {
    var d = App.doc, box = h("div", { class: "rb-wrap" });
    box.appendChild(h("div", { class: "ptitle" }, "ページ"));
    box.appendChild(group("ページ設定",
      row("サイズ", seg([["A4", "A4"], ["B4", "B4"], ["B5", "B5"], ["A3", "A3"]], d.paper, function (v) { App.changePaper(v, d.orient); })),
      row("印刷の向き", seg([["portrait", "縦"], ["landscape", "横"]], d.orient, function (v) { App.changePaper(d.paper, v); })),
      h("div", { title: "A4で作ってB4で刷る、という使い方ができます。コピー機の拡大と同じで、マスも字も同じ割合で大きくなります。" },
        check("サイズを変えたら、中身も拡大・縮小する", App.fitOnPaper, function (v) { App.fitOnPaper = v; })),
      row("余白", docNum("margin", 0, 40, 1, "mm"), "画面だけの線です。刷られません。"),
      row("グリッド", select([["0.5", "0.5 mm"], ["1", "1 mm"], ["2.5", "2.5 mm"], ["5", "5 mm"], ["10", "10 mm"]], String(d.snap), function (v) { d.snap = parseFloat(v); App.commit(); }))
    ));
    box.appendChild(fontGroup());
    box.appendChild(h("div", { class: "rb-tip" },
      h("span", null, "マス目や図形をクリックすると、ここに書式の設定が出ます。", h("br"), "マス目やテキストボックスは、中をクリックするとそのまま入力できます。"),
      button("使い方", function () { App.openHelp(); })));
    return box;
  }
  /** 使い方と、刷るときの注意。 */
  App.openHelp = function () {
    var old = document.getElementById("help-dialog");
    if (old) old.remove();
    function close() { wrap.remove(); }
    var body = h("div", { class: "dlg-body help-body" },
      h("h3", null, "使い方"),
      h("ul", null,
        h("li", null, h("b", null, "置く"), "左の道具を押します。線と図形は、紙の上をドラッグして描きます。画像は、紙の上にファイルを落としても、Ctrl+V で貼っても置けます。"),
        h("li", null, h("b", null, "打つ"), "マス目やテキストボックスの中をクリックすると、そのまま入力できます。"),
        h("li", null, h("b", null, "直す"), "マス目や図形をクリックすると、上に書式の設定が出ます。複製と削除は、選んだもののすぐ上の小さなバーにもあります。"),
        h("li", null, h("b", null, "動かす"), "上のつまみか、まわりの枠をドラッグします。"),
        h("li", null, h("b", null, "足す"), "紙面の下の「同じ形のページを追加」で、同じ紙をもう1ページ作れます。")),
      h("h3", null, "刷るとき"),
      h("ul", null,
        h("li", null, "右上の「印刷」を押します。"),
        h("li", null, "印刷の画面で、用紙をこの紙面と同じ大きさにします。"),
        h("li", null, "余白は「なし」、倍率は100%にします。"),
        h("li", null, "送信先を「PDFに保存」にすると、PDFになります。")),
      h("h3", null, "字の形"),
      h("ul", null,
        h("li", null, "教科書体は、パソコンに入っている UDデジタル教科書体を使います。入っていないときは、この道具に入っている Klee One で表示します。"),
        h("li", null, "ほかのフォントを使いたいときは、マス目やテキストボックスを選んで「フォント」から「パソコンの中のフォントから選ぶ」を押します。")));
    var wrap = h("div", { id: "help-dialog", class: "dlg", onmousedown: function (ev) { if (ev.target === wrap) close(); } },
      h("div", { class: "dlg-box", role: "dialog", "aria-label": "使い方" },
        h("div", { class: "dlg-head" }, h("b", null, "使い方"), h("button", { type: "button", class: "btn ghost", onclick: close }, "閉じる")), body));
    document.body.appendChild(wrap);
  };
  /** 教科書体として、いま実際に使われている字を知らせる。 */
  function fontGroup() {
    var use = App.kyokashoInUse(), msg;
    if (use.rank === 0) msg = "教科書体は「UDデジタル教科書体」で表示しています。";
    else if (use.rank === 1) msg = "教科書体は「游教科書体」で表示しています。";
    else if (use.rank === 2) msg = "このパソコンには UDデジタル教科書体が入っていません。かわりに、この道具に入っている「Klee One」で表示しています。マスの位置は変わりません。";
    else msg = "教科書体の字が読みこめていません。丸ゴシック体で表示しています。";
    var short = use.rank === 0 ? "UDデジタル教科書体" : use.rank === 1 ? "游教科書体" : use.rank === 2 ? "Klee One（入っている字のかわり）" : "丸ゴシック体（かわり）";
    return group("フォント",
      h("div", { class: "row", title: msg }, h("span", { class: "lb" }, "教科書体"), h("span", { class: "ct", id: "font-short" }, short)),
      h("p", { class: "hint", id: "font-now" }, msg));
  }
  function docNum(key, min, max, step, unit) {
    var d = App.doc;
    var inp = h("input", { type: "number", value: d[key], min: min, max: max, step: step });
    inp.addEventListener("input", function () {
      var v = parseFloat(inp.value);
      if (isNaN(v)) return;
      d[key] = clamp(v, min, max);
      App.commit("doc-" + key);
      App.renderAll();
    });
    return h("span", { class: "num" }, inp, h("span", { class: "unit" }, unit));
  }
  App.fitOnPaper = true;
  /** 用紙を変えて、画面を描きなおす。 */
  App.changePaper = function (paper, orient) {
    App.stopEditing();
    var before = App.pageSize(), prevOrient = App.doc.orient;
    App.setPaper(paper, orient, App.fitOnPaper);
    var after = App.pageSize();
    App.selId = null;
    App.commit();
    App.renderAll();
    App.fitWidth(1);
    App.renderPanel();
    App.syncHeader();
    if (App.fitOnPaper && prevOrient === App.doc.orient && before[0] !== after[0]) {
      App.toast("中身を " + Math.round(after[0] / before[0] * 100) + "% にしました。「元に戻す」で戻せます。");
    }
  };

  function commonPanel(b) {
    var pos;
    if (b.type === "line") pos = null;
    else pos = row("位置", h("span", { class: "pair" },
      num(b, "x", { min: -100, max: 500, step: 1, unit: "左" }),
      num(b, "y", { min: -100, max: 500, step: 1, unit: "上" })));
    return group("配置",
      pos,
      h("div", { class: "btns" },
        button("前面へ", function () { App.reorder(b.id, "front"); }),
        button("背面へ", function () { App.reorder(b.id, "back"); }),
        button("複製", function () { App.duplicate(b.id); }),
        button("削除", function () { App.removeBlock(b.id); }, "danger"))
    );
  }

  function masuPanel(p, b) {
    var cellNum = num(b, "cell", { min: 4, max: 40, step: 0.5, unit: "mm" });
    var linesNum = num(b, "lines", { min: 1, max: 80, step: 1, unit: "行", set: function (v) { App.setMasuLines(b, v); } });
    p.appendChild(group(null,
      row("文字の方向", seg([["v", "縦書き"], ["h", "横書き"]], b.dir, function (v) {
        b.dir = v;
        // 向きを変えて紙からはみ出すときは、紙の中へ寄せる
        var g = App.masuGeom(b), size = App.pageSize(), m = App.doc.margin || 0;
        if (b.x + g.W > size[0] - m) b.x = Math.max(0, App.snap(size[0] - m - g.W));
        if (b.y + g.H > size[1] - m) b.y = Math.max(0, App.snap(size[1] - m - g.H));
        touch(b, null, true);
      })),
      row("マスのサイズ", cellNum),
      h("div", { class: "row sub" }, chips([8, 10, 12, 15, 20], function (v) { b.cell = v; cellNum.input.value = v; touch(b); }, function (v) { return v + "mm"; })),
      row("文字数", num(b, "perLine", { min: 1, max: 80, step: 1, unit: "字" })),
      row("行数", linesNum),
      row("行間", num(b, "gap", { min: 0, max: 12, step: 0.5, unit: "mm" })),
      check("行数を自動で増やす", b.autoGrow !== false, function (v) { b.autoGrow = v; touch(b); })
    ));

    p.appendChild(group("フォント",
      row("サイズ", seg([[0.64, "小"], [0.78, "中"], [0.88, "大"]], b.fontScale, function (v) { b.fontScale = v; touch(b); })),
      fontRow(b),
      row("フォントの色", swatches(App.TEXT_COLORS, b.color, function (v) { b.color = v; touch(b); }))
    ));

    p.appendChild(group("選択した文字",
      h("p", { class: "hint" }, "マス目の中をドラッグして、文字を選択します。"),
      row("フォントの色", swatches(App.TEXT_COLORS, null, function (v) { App.applyMasuStyle({ color: v === "#1b1b1b" ? null : v }); })),
      h("div", { class: "row stack" }, h("span", { class: "lb" }, "傍線"),
        h("span", { class: "ct" }, seg([["none", "なし"], ["single", "一重線"], ["double", "二重線"], ["wave", "波線"]], null, function (v) { App.applyMasuStyle({ side: v === "none" ? null : v }); }))),
      h("div", { class: "btns" },
        button("太字", function () { App.applyMasuStyle({ bold: true }); }),
        button("囲み線", function () { App.applyMasuStyle({ box: true }); }),
        button("書式のクリア", function () { App.clearMasuStyle(); }))
    ));

    var gridColors = Object.keys(App.GRID_COLORS).map(function (k) { return [App.GRID_COLORS[k].name, App.GRID_COLORS[k].solid, k]; });
    p.appendChild(group("罫線",
      row("線の色", swatches(gridColors, (App.GRID_COLORS[b.gridColor] || App.GRID_COLORS.green).solid, function (v) {
        gridColors.forEach(function (g) { if (g[1] === v) b.gridColor = g[2]; });
        touch(b);
      })),
      row("線の種類", seg([["solid", "実線"], ["dotted", "点線"], ["none", "なし"]], b.lineStyle, function (v) { b.lineStyle = v; touch(b); })),
      check("十字リーダー（点線）を入れる", b.leader, function (v) { b.leader = v; touch(b); }),
      check("外枠を太くする", b.frame, function (v) { b.frame = v; touch(b); })
    ));

    var r = b.rules;
    p.appendChild(group("原稿用紙設定",
      check("「。」と「」」を同じマスに入れる", r.kutenKagi, function (v) { r.kutenKagi = v; touch(b); }),
      check("会話文の2行目から1マス下げる", r.kaiwaSage, function (v) { r.kaiwaSage = v; touch(b); }),
      check("段落の先頭を自動で1マス空ける", r.danrakuSage, function (v) { r.danrakuSage = v; touch(b); }),
      check("半角の数字は2字で1マスにする", r.hankaku2, function (v) { r.hankaku2 = v; touch(b); }),
      row("行頭の句読点", select([["in", "前の行の最後のマスに入れる"], ["out", "前の行のマスの外に出す"], ["off", "そのまま次の行に置く"]], r.gyotou, function (v) { r.gyotou = v; touch(b); }))
    ));
  }

  function textPanel(p, b) {
    var sizeNum = num(b, "size", { min: 6, max: 120, step: 0.5, unit: "pt" });
    p.appendChild(group(null,
      row("文字の方向", seg([["h", "横書き"], ["v", "縦書き"]], b.dir, function (v) { b.dir = v; touch(b, null, true); })),
      row("フォント サイズ", sizeNum),
      h("div", { class: "row sub" }, chips([11, 14, 18, 24, 36], function (v) { b.size = v; sizeNum.input.value = v; touch(b); })),
      fontRow(b),
      row("フォントの色", swatches(App.TEXT_COLORS, b.color, function (v) {
        if (!App.applyTextCommand("foreColor", v)) { b.color = v; touch(b); }
      })),
      h("div", { class: "btns" },
        button("太字", function () { if (!App.applyTextCommand("bold")) { b.bold = !b.bold; touch(b); } }),
        button("下線", function () { if (!App.applyTextCommand("underline")) App.toast("下線は、文字を選択してから押してください。"); })),
      h("p", { class: "hint" }, "文字を選択しているときは、そこだけに色や太字がつきます。"),
      row("文字の配置", seg(b.dir === "v" ? [["start", "上"], ["center", "中央"], ["end", "下"]] : [["start", "左"], ["center", "中央"], ["end", "右"]], b.align, function (v) { b.align = v; touch(b); })),
      row("行間", num(b, "lineHeight", { min: 1, max: 3, step: 0.1, unit: "倍" }))
    ));
    p.appendChild(group("枠線と塗りつぶし",
      row("枠線", select([["none", "なし"], ["solid", "実線"], ["dotted", "点線"], ["bold", "太線"]], b.border, function (v) { b.border = v; touch(b); })),
      row("塗りつぶし", swatches(App.FILL_COLORS, b.fill, function (v) { b.fill = v; touch(b); })),
      row("余白", num(b, "pad", { min: 0, max: 15, step: 0.5, unit: "mm" }))
    ));
  }

  function strokeRows(b) {
    var widthNum = num(b, "width", { min: 0.1, max: 5, step: 0.1, unit: "mm" });
    return [
      row("線の色", swatches(App.LINE_COLORS, b.color, function (v) { b.color = v; touch(b); })),
      row("線の太さ", widthNum),
      h("div", { class: "row sub" }, chips([0.3, 0.5, 0.8, 1.2, 2], function (v) { b.width = v; widthNum.input.value = v; touch(b); })),
      row("線の種類", seg([["solid", "実線"], ["dash", "破線"], ["dot", "点線"]], b.dash, function (v) { b.dash = v; touch(b); }))
    ];
  }
  function linePanel(p, b) {
    var g = group(null);
    strokeRows(b).forEach(function (r) { g.appendChild(r); });
    g.appendChild(row("矢印", seg([["none", "なし"], ["end", "片方"], ["both", "両方"]], b.arrow, function (v) { b.arrow = v; touch(b); })));
    g.appendChild(h("p", { class: "hint" }, "Shiftを押しながら端を動かすと、水平・垂直・45度にそろいます。"));
    p.appendChild(g);
  }
  function rectPanel(p, b) {
    var g = group(null, row("図形", seg([["rect", "四角形"], ["round", "角丸四角形"], ["ellipse", "楕円"]], b.shape, function (v) { b.shape = v; touch(b); })));
    strokeRows(b).forEach(function (r) { g.appendChild(r); });
    g.appendChild(row("塗りつぶし", swatches(App.FILL_COLORS, b.fill, function (v) { b.fill = v; touch(b); })));
    p.appendChild(g);
  }

  function hissanPanel(p, b) {
    var note = h("p", { class: "hint" });
    function showAnswer() {
      var sol = Hissan.solve(b.expr, { zeroStep: b.zeroStep });
      note.textContent = sol.ok ? "答え　" + sol.answer : sol.error;
      note.classList.toggle("err", !sol.ok);
      divRow.style.display = sol.ok && sol.op === "div" ? "" : "none";
    }
    var inp = h("input", { type: "text", value: b.expr, "data-main": "1", placeholder: "92÷4", spellcheck: "false" });
    inp.addEventListener("input", function () { b.expr = inp.value; touch(b, "expr"); showAnswer(); });
    var divRow = row("商に0がたつ段", seg([["skip", "省く"], ["write", "書く"]], b.zeroStep, function (v) { b.zeroStep = v; touch(b); showAnswer(); }));
    p.appendChild(group(null,
      row("式", inp),
      h("div", { class: "row sub" }, chips(["+", "−", "×", "÷"], function (v) { insertAt(inp, v); })),
      note,
      row("表示", seg([["problem", "問題だけ"], ["answer", "答えつき"]], b.mode, function (v) { b.mode = v; touch(b); })),
      row("マスのサイズ", num(b, "cell", { min: 5, max: 25, step: 0.5, unit: "mm" })),
      row("方眼", seg([["hougan", "方眼"], ["masu", "マス"], ["none", "なし"]], b.grid, function (v) { b.grid = v; touch(b); })),
      row("答えの色", swatches([["赤", "#d12a1e"], ["黒", "#1b1b1b"], ["青", "#1d5fbf"]], b.ansColor, function (v) { b.ansColor = v; touch(b); })),
      divRow,
      row("予備の行", num(b, "spare", { min: 0, max: 6, step: 1, unit: "行" }))
    ));
    p.appendChild(h("p", { class: "hint pad" }, "方眼の高さは、子どもが途中の計算を省かずに書いたときの行数で取っています。小数は、たし算とひき算で使えます。"));
    showAnswer();
  }

  function shikiPanel(p, b) {
    var inp = h("input", { type: "text", value: b.src, "data-main": "1", spellcheck: "false" });
    inp.addEventListener("input", function () { b.src = inp.value; touch(b, "src"); });
    var sizeNum = num(b, "size", { min: 8, max: 72, step: 1, unit: "pt" });
    p.appendChild(group(null,
      row("式", inp),
      h("div", { class: "row sub" }, chips(["×", "÷", "=", "□", "と", "/"], function (v) { insertAt(inp, v); })),
      h("p", { class: "hint" }, "分数は 2/3、帯分数は 1と2/3、わり算は ÷ で入れます。"),
      row("フォント サイズ", sizeNum),
      h("div", { class: "row sub" }, chips([14, 18, 24, 32], function (v) { b.size = v; sizeNum.input.value = v; touch(b); })),
      row("フォントの色", swatches(App.TEXT_COLORS, b.color, function (v) { b.color = v; touch(b); })),
      fontRow(b)
    ));
  }
  function insertAt(inp, v) {
    var a = inp.selectionStart === null ? inp.value.length : inp.selectionStart, z = inp.selectionEnd === null ? a : inp.selectionEnd;
    inp.value = inp.value.slice(0, a) + v + inp.value.slice(z);
    inp.focus();
    inp.setSelectionRange(a + v.length, a + v.length);
    inp.dispatchEvent(new Event("input"));
  }

  function imagePanel(p, b) {
    p.appendChild(group(null, h("div", { class: "btns" }, button("画像を入れかえる", function () { pickImage(function (src, w, hh) {
      b.src = src; b.h = b.w * hh / w; touch(b);
    }); }))));
  }

  // ---------- 画像を読む ----------
  function pickImage(done) {
    var inp = App.$("#file-image");
    inp.value = "";
    inp.onchange = function () {
      var file = inp.files && inp.files[0];
      if (file) readImageFile(file, done);
    };
    inp.click();
  }
  /** 画像のファイルを読む。大きすぎるものは、刷るのに足りる大きさまで小さくする。 */
  function readImageFile(file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, hh = img.naturalHeight, src = reader.result;
        if (file.size > 600 * 1024 && Math.max(w, hh) > max) {
          var k = max / Math.max(w, hh), cv = document.createElement("canvas");
          cv.width = Math.round(w * k); cv.height = Math.round(hh * k);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          src = cv.toDataURL(/png/i.test(file.type) ? "image/png" : "image/jpeg", 0.9);
        }
        done(src, w, hh);
      };
      img.onerror = function () { App.toast("この画像は読めませんでした。"); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  /** 画像を紙面に置く。幅は紙の3分の1ほど。at は紙の上の点（mm）。 */
  function placeImage(file, at) {
    readImageFile(file, function (src, w, hh) {
      var size = App.pageSize(), bw = Math.min(90, Math.round(size[0] / 3)), bh = bw * hh / w;
      var maxH = size[1] * 0.6;
      if (bh > maxH) { bw = bw * maxH / bh; bh = maxH; }
      App.addBlock("image", { src: src, w: round2(bw), h: round2(bh), at: at || null });
    });
  }
  function imageFiles(list) {
    return Array.prototype.filter.call(list || [], function (f) { return f && /^image\//.test(f.type); });
  }
  /** 貼り付け（Ctrl+V）と、ファイルのドラッグで画像を置く。 */
  function wireImageInput() {
    document.addEventListener("paste", function (ev) {
      var cd = ev.clipboardData;
      if (!cd) return;
      var files = imageFiles(cd.files);
      if (!files.length || cd.getData("text/plain")) return;   // 字もあるときは、字の貼り付けにまかせる
      var t = ev.target;
      if (t && t.closest && t.closest("#panel, .bar, .dlg")) return;
      ev.preventDefault();
      ev.stopPropagation();
      placeImage(files[0]);
      App.toast("画像を貼りました。");
    }, true);

    var stage = App.$("#stage"), depth = 0;
    function hasFiles(ev) { return ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], "Files") >= 0; }
    window.addEventListener("dragenter", function (ev) { if (hasFiles(ev)) { depth++; document.body.classList.add("dropping"); } });
    window.addEventListener("dragleave", function (ev) { if (hasFiles(ev) && --depth <= 0) { depth = 0; document.body.classList.remove("dropping"); } });
    window.addEventListener("dragover", function (ev) { if (hasFiles(ev)) ev.preventDefault(); });
    window.addEventListener("drop", function (ev) {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      depth = 0;
      document.body.classList.remove("dropping");
      var files = ev.dataTransfer.files, imgs = imageFiles(files);
      if (!imgs.length) {
        // 紙面のファイルなら開く
        var f = files[0];
        if (f && /\.json$/i.test(f.name)) {
          f.text().then(function (tx) { if (!App.loadDoc(JSON.parse(tx))) throw 0; }).catch(function () { App.toast("このファイルは開けませんでした。"); });
        } else App.toast("置けるのは画像のファイルです。");
        return;
      }
      // 落とした点の下にある紙を探す
      var at = null, el = document.elementFromPoint(ev.clientX, ev.clientY), page = el && el.closest && el.closest(".page");
      if (page && stage.contains(page)) {
        var pages = Array.prototype.slice.call(App.$("#pages").querySelectorAll(".page")), pi = pages.indexOf(page);
        var r = page.getBoundingClientRect(), k = App.pxPerMm(page);
        if (pi >= 0) at = { page: pi, x: (ev.clientX - r.left) / k, y: (ev.clientY - r.top) / k };
      }
      placeImage(imgs[0], at);
    });
  }

  // ---------- 左の道具 ----------
  function buildTools() {
    var box = App.$("#tools");
    function tool(key, label, title, onClick, drawTool) {
      var btn = h("button", { type: "button", title: title, "data-tool": drawTool || null, onclick: onClick }, icon(ICONS[key]), h("span", null, label));
      box.appendChild(btn);
    }
    tool("masu", "マス目", "マス目を置く", function () { App.addBlock("masu"); });
    tool("text", "テキスト", "テキストボックスを置く", function () { App.addBlock("text"); });
    tool("name", "名前欄", "年・組・名前の欄を置く", function () {
      App.addBlock("text", { w: 100, h: 9, html: "　年　組　名前（　　　　　　　　　　）" });
      App.stopEditing();
      App.renderPanel();
    });
    box.appendChild(h("hr"));
    tool("line", "線", "紙の上をドラッグして線を引く", function () { App.stopEditing(); App.setTool(App.tool === "line" ? null : "line"); }, "line");
    tool("arrow", "矢印", "紙の上をドラッグして矢印を引く", function () { App.stopEditing(); App.setTool(App.tool === "arrow" ? null : "arrow"); }, "arrow");
    tool("rect", "四角形", "紙の上をドラッグして四角形を描く", function () { App.stopEditing(); App.setTool(App.tool === "rect" ? null : "rect"); }, "rect");
    tool("ellipse", "楕円", "紙の上をドラッグして楕円を描く", function () { App.stopEditing(); App.setTool(App.tool === "ellipse" ? null : "ellipse"); }, "ellipse");
    box.appendChild(h("hr"));
    tool("hissan", "筆算", "筆算を置く", function () { App.addBlock("hissan"); });
    tool("shiki", "数式", "分数などの数式を置く", function () { App.addBlock("shiki"); });
    tool("image", "画像", "画像を置く（紙の上にファイルを落としても、Ctrl+V で貼っても置けます）", function () {
      pickImage(function (src, w, hh) { App.addBlock("image", { src: src, w: 60, h: 60 * hh / w }); });
    });
  }

  // ---------- 上のバー ----------
  App.syncHeader = function () {
    var t = App.$("#doc-title");
    if (document.activeElement !== t) t.value = App.doc.title;
    App.$("#paper").value = App.doc.paper + ":" + App.doc.orient;
    document.title = App.doc.title + "｜マス目プリントメーカー";
  };
  App.onHistory = function () {
    App.$("#btn-undo").disabled = !App.canUndo();
    App.$("#btn-redo").disabled = !App.canRedo();
  };

  function wireHeader() {
    var title = App.$("#doc-title");
    title.addEventListener("input", function () { App.doc.title = title.value || "無題のプリント"; App.commit("title"); document.title = App.doc.title + "｜マス目プリントメーカー"; });

    var tpl = App.$("#tpl");
    var base = h("optgroup", { label: "テンプレート" });
    Object.keys(App.templates).forEach(function (k) { base.appendChild(h("option", { value: "t:" + k }, App.templates[k].name)); });
    tpl.appendChild(base);
    var examples = window.MASUME_EXAMPLES || [];
    if (examples.length) {
      var eg = h("optgroup", { label: "教科の事例" });
      examples.forEach(function (ex, i) { eg.appendChild(h("option", { value: "e:" + i }, ex.name)); });
      tpl.appendChild(eg);
    }
    tpl.addEventListener("change", function () {
      var v = tpl.value, kind = v.slice(0, 2), key = v.slice(2), d = null;
      tpl.value = "";
      if (kind === "t:" && App.templates[key]) d = App.templates[key].build();
      if (kind === "e:" && examples[+key]) d = examples[+key].doc;
      if (!d) return;
      if (App.loadDoc(d)) App.toast("紙面を置きかえました。「元に戻す」で前の紙面に戻れます。");
    });

    var paper = App.$("#paper");
    [["A4", "A4"], ["B4", "B4"], ["B5", "B5"], ["A3", "A3"]].forEach(function (p) {
      [["portrait", "たて"], ["landscape", "よこ"]].forEach(function (o) {
        paper.appendChild(h("option", { value: p[0] + ":" + o[0] }, p[1] + " " + o[1]));
      });
    });
    paper.addEventListener("change", function () {
      var v = paper.value.split(":");
      App.changePaper(v[0], v[1]);
    });

    App.$("#btn-undo").addEventListener("click", function () { App.undo(); });
    App.$("#btn-redo").addEventListener("click", function () { App.redo(); });
    App.$("#zoom-out").addEventListener("click", function () { App.setScale(App.scale - 0.1); });
    App.$("#zoom-in").addEventListener("click", function () { App.setScale(App.scale + 0.1); });
    App.$("#zoom-fit").addEventListener("click", function () { App.fitWidth(); });
    App.$("#btn-print").addEventListener("click", function () { App.print(); });
    App.$("#btn-save").addEventListener("click", function () { App.saveFile(); });
    App.$("#btn-open").addEventListener("click", function () { var f = App.$("#file-open"); f.value = ""; f.click(); });
    App.$("#file-open").addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var ok = false;
        try { ok = App.loadDoc(JSON.parse(reader.result)); } catch (e) { ok = false; }
        if (!ok) App.toast("このファイルは開けませんでした。");
      };
      reader.readAsText(file);
    });
  }

  App.print = function () {
    App.stopEditing();
    window.print();
  };
  App.saveFile = function () {
    App.stopEditing();
    var blob = new Blob([JSON.stringify(App.doc, null, 1)], { type: "application/json" });
    var a = h("a", { href: URL.createObjectURL(blob), download: (App.doc.title || "プリント") + ".masume.json" });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  // ---------- 起動 ----------
  function boot() {
    var params = new URLSearchParams(location.search), t = params.get("t");
    var d = t && App.templates[t] ? App.templates[t].build() : (App.loadSaved() || App.templates.sample.build());
    App.doc = App.normalizeDoc(d);
    App.resetHistory();
    buildTools();
    wireHeader();
    wireImageInput();
    App.initEditing();
    App.renderAll();
    App.fitWidth(1);
    App.renderPanel();
    App.syncHeader();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { App.measureAuto(); App.drawSelection(); });
      // 同梱の字があとから読みこまれたら、測りなおして「いまの字」の表示も直す
      document.fonts.addEventListener("loadingdone", function () {
        App.measureAuto(); App.drawSelection();
        if (!App.selected() && !App.$("#panel").contains(document.activeElement)) App.renderPanel();
      });
    }
    if (App.warnMissingFonts) App.warnMissingFonts();
    // ?e=3 で教科の事例を、?src=〜.json で紙面のファイルを開く
    var ex = params.get("e"), src = params.get("src"), list = window.MASUME_EXAMPLES || [];
    if (ex !== null && list[+ex]) { App.loadDoc(list[+ex].doc); App.resetHistory(); }
    else if (src && /^examples\/[\w\-]+\.json$/.test(src)) {   // この道具の examples フォルダの中だけ
      fetch(src).then(function (r) { return r.json(); }).then(function (j) { if (App.loadDoc(j)) App.resetHistory(); })
        .catch(function () { App.toast("紙面のファイルを開けませんでした。"); });
    }
  }
  boot();
})();
