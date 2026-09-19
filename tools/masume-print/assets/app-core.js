/* app-core.js — 紙面のデータ、元に戻す、自動保存、ひな形。 */
(function () {
  "use strict";

  var App = (window.App = window.App || {});

  // ---------- 小道具 ----------
  App.SVGNS = "http://www.w3.org/2000/svg";
  App.MM = 96 / 25.4; // 1mm は何pxか（CSSの決まり）
  App.$ = function (s, r) { return (r || document).querySelector(s); };
  App.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  App.uid = function () { return "b" + Math.random().toString(36).slice(2, 9); };

  /** HTMLの部品を作る。attrs の on〜 はイベント、style は文字列かオブジェクト。 */
  App.h = function (tag, attrs) {
    var el = document.createElement(tag);
    setAttrs(el, attrs);
    appendKids(el, Array.prototype.slice.call(arguments, 2));
    return el;
  };
  /** SVGの部品を作る。 */
  App.s = function (tag, attrs) {
    var el = document.createElementNS(App.SVGNS, tag);
    setAttrs(el, attrs);
    appendKids(el, Array.prototype.slice.call(arguments, 2));
    return el;
  };
  function setAttrs(el, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.keys(v).forEach(function (p) { el.style.setProperty(p, v[p]); });
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    });
  }
  function appendKids(el, kids) {
    kids.forEach(function (k) {
      if (k === null || k === undefined || k === false) return;
      if (Array.isArray(k)) return appendKids(el, k);
      el.appendChild(typeof k === "string" || typeof k === "number" ? document.createTextNode(String(k)) : k);
    });
  }

  // ---------- 決まった値 ----------
  App.PAPER = { A4: [210, 297], B5: [182, 257], B4: [257, 364], A3: [297, 420] };

  App.FONTS = {
    kyokasho: '"UDデジタル教科書体 ProN","UDDigiKyokasho ProN","UD デジタル 教科書体 N-R","UD Digi Kyokasho N-R","UDデジタル教科書体 StdN","游教科書体 New","YuKyokasho","Klee One","Hiragino Maru Gothic ProN",sans-serif',
    gothic: '"BIZ UDGothic","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif',
    mincho: '"BIZ UDMincho","Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif',
    maru: '"Hiragino Maru Gothic ProN","BIZ UDGothic","Yu Gothic",sans-serif'
  };
  App.FONT_NAMES = [["kyokasho", "教科書体"], ["gothic", "ゴシック体"], ["mincho", "明朝体"], ["maru", "丸ゴシック体"]];

  App.TEXT_COLORS = [["黒", "#1b1b1b"], ["赤", "#d12a1e"], ["青", "#1d5fbf"], ["緑", "#1f7a45"], ["うすい灰（なぞり書き用）", "#b9bcc0"]];
  App.LINE_COLORS = [["黒", "#1b1b1b"], ["灰", "#8a8f96"], ["赤", "#d12a1e"], ["青", "#1d5fbf"], ["緑", "#1f7a45"]];
  App.FILL_COLORS = [["なし", "none"], ["白", "#ffffff"], ["うすい灰", "#f0f0ee"], ["うすい黄", "#fff6cf"], ["うすい青", "#e6f0fb"]];
  App.GRID_COLORS = {
    green: { name: "緑", solid: "#7fb994", dot: "#9fcbaf" },
    gray: { name: "灰", solid: "#9b9fa6", dot: "#bfc3c8" },
    black: { name: "黒", solid: "#2a2a2a", dot: "#8c8c8c" },
    brown: { name: "茶", solid: "#b08a5a", dot: "#cdb38f" },
    blue: { name: "青", solid: "#6fa3d8", dot: "#a5c6e8" }
  };

  App.TYPE_NAMES = { masu: "マス目", text: "テキスト ボックス", line: "線", rect: "図形", hissan: "筆算", shiki: "数式", image: "画像" };

  // ---------- いまの状態 ----------
  App.doc = null;
  App.selId = null;   // 選んでいる部品
  App.edit = null;    // 文字を打っている部品 {id, type, anchor, focus}
  App.tool = null;    // 線や図形を「ドラッグで描く」状態
  App.scale = 1;
  App.layouts = {};   // マス目の流し込みの結果（部品ごと）

  App.pageSize = function () {
    var p = App.PAPER[App.doc.paper] || App.PAPER.A4;
    return App.doc.orient === "landscape" ? [p[1], p[0]] : [p[0], p[1]];
  };
  App.snap = function (v) {
    var st = App.doc.snap || 1;
    return Math.round(v / st) * st;
  };
  App.find = function (id) {
    for (var p = 0; p < App.doc.pages.length; p++) {
      var bs = App.doc.pages[p].blocks;
      for (var i = 0; i < bs.length; i++) if (bs[i].id === id) return { block: bs[i], page: p, index: i };
    }
    return null;
  };
  App.selected = function () {
    var f = App.selId ? App.find(App.selId) : null;
    return f ? f.block : null;
  };

  // ---------- 部品のひな形 ----------
  App.make = {
    masu: function (o) {
      return Object.assign({
        id: App.uid(), type: "masu", x: 20, y: 30, dir: "v", cell: 10, perLine: 12, lines: 8, gap: 0,
        leader: false, frame: true, lineStyle: "solid", gridColor: "green",
        text: "", styles: [], fontScale: 0.78, font: "kyokasho", color: "#1b1b1b", autoGrow: true,
        rules: Object.assign({}, Masu.DEFAULT_RULES, { kaiwaSage: true })
      }, o || {});
    },
    text: function (o) {
      return Object.assign({
        id: App.uid(), type: "text", x: 20, y: 20, w: 80, h: 12, dir: "h", html: "", size: 12, font: "kyokasho",
        color: "#1b1b1b", bold: false, align: "start", lineHeight: 1.6, border: "none", fill: "none", pad: 1.5
      }, o || {});
    },
    line: function (o) {
      return Object.assign({
        id: App.uid(), type: "line", x1: 20, y1: 20, x2: 70, y2: 20, color: "#1b1b1b", width: 0.5, dash: "solid", arrow: "none"
      }, o || {});
    },
    rect: function (o) {
      return Object.assign({
        id: App.uid(), type: "rect", x: 20, y: 20, w: 60, h: 30, shape: "rect", color: "#1b1b1b", width: 0.5, dash: "solid", fill: "none"
      }, o || {});
    },
    hissan: function (o) {
      return Object.assign({
        id: App.uid(), type: "hissan", x: 20, y: 20, expr: "92÷4", mode: "problem", cell: 10, grid: "hougan",
        ansColor: "#d12a1e", zeroStep: "skip", spare: 0, font: "kyokasho"
      }, o || {});
    },
    shiki: function (o) {
      return Object.assign({
        id: App.uid(), type: "shiki", x: 20, y: 20, src: "2/3 + 1/4 = □", size: 16, color: "#1b1b1b", font: "kyokasho"
      }, o || {});
    },
    image: function (o) {
      return Object.assign({ id: App.uid(), type: "image", x: 20, y: 20, w: 60, h: 40, src: "" }, o || {});
    }
  };

  // ---------- 元に戻す ----------
  var hist = { stack: [], idx: -1, key: null, time: 0 };

  /** 変更を確定する。同じ key が続くあいだ（文字入力など）は1回ぶんにまとめる。 */
  App.commit = function (key) {
    var snap = JSON.stringify(App.doc);
    var now = Date.now();
    if (hist.idx >= 0 && hist.stack[hist.idx] === snap) return;
    if (key && hist.key === key && now - hist.time < 1200 && hist.idx === hist.stack.length - 1 && hist.idx > 0) {
      hist.stack[hist.idx] = snap;
    } else {
      hist.stack.length = hist.idx + 1;
      hist.stack.push(snap);
      if (hist.stack.length > 120) hist.stack.shift();
      hist.idx = hist.stack.length - 1;
    }
    hist.key = key || null;
    hist.time = now;
    scheduleSave();
    if (App.onHistory) App.onHistory();
  };
  App.canUndo = function () { return hist.idx > 0; };
  App.canRedo = function () { return hist.idx < hist.stack.length - 1; };
  App.undo = function () { if (App.canUndo()) { hist.idx--; restore(); } };
  App.redo = function () { if (App.canRedo()) { hist.idx++; restore(); } };
  function restore() {
    App.doc = JSON.parse(hist.stack[hist.idx]);
    hist.key = null;
    scheduleSave();
    if (App.onRestore) App.onRestore();
    if (App.onHistory) App.onHistory();
  }
  App.resetHistory = function () {
    hist.stack = [JSON.stringify(App.doc)];
    hist.idx = 0;
    hist.key = null;
    if (App.onHistory) App.onHistory();
  };

  // ---------- 自動保存 ----------
  var SAVE_KEY = "masume-print.v1";
  var saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(App.doc));
        App.saveFailed = false;
      } catch (e) {
        if (!App.saveFailed && App.toast) App.toast("画像が大きいため自動保存できません。「保存」でファイルに残してください。");
        App.saveFailed = true;
      }
    }, 400);
  }
  App.loadSaved = function () {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return App.normalizeDoc(JSON.parse(raw));
    } catch (e) { return null; }
  };

  /** 読みこんだデータの欠けている値を補う。 */
  App.normalizeDoc = function (d) {
    if (!d || !Array.isArray(d.pages)) return null;
    d.version = 1;
    d.title = d.title || "無題のプリント";
    d.paper = App.PAPER[d.paper] ? d.paper : "A4";
    d.orient = d.orient === "landscape" ? "landscape" : "portrait";
    d.margin = typeof d.margin === "number" ? d.margin : 10;
    d.snap = d.snap || 1;
    d.pages = d.pages.filter(function (pg) { return pg && typeof pg === "object"; });
    d.pages.forEach(function (pg) {
      pg.blocks = (Array.isArray(pg && pg.blocks) ? pg.blocks : []).filter(function (b) {
        // 知っている種類の部品だけを通す（"constructor" のような名前で、作りつけの関数を呼ばせない）
        return b && typeof b === "object" && typeof b.type === "string" && Object.prototype.hasOwnProperty.call(App.make, b.type);
      }).map(function (b) {
        var full = App.make[b.type](b);
        if (full.type === "masu") full.rules = Object.assign({}, Masu.DEFAULT_RULES, b.rules || {});
        return full;
      });
    });
    if (!d.pages.length) d.pages.push({ blocks: [] });
    return d;
  };

  // ---------- 用紙を変える ----------
  function r2(v) { return Math.round(v * 100) / 100; }

  /** 紙面の部品をぜんぶ k 倍にする（コピー機の拡大・縮小と同じ）。 */
  App.scaleDoc = function (d, k) {
    d.pages.forEach(function (pg) {
      pg.blocks.forEach(function (b) {
        if (b.type === "line") { b.x1 = r2(b.x1 * k); b.y1 = r2(b.y1 * k); b.x2 = r2(b.x2 * k); b.y2 = r2(b.y2 * k); }
        else { b.x = r2(b.x * k); b.y = r2(b.y * k); if (b.w) b.w = r2(b.w * k); if (b.h) b.h = r2(b.h * k); }
        if (b.type === "masu") { b.cell = r2(b.cell * k); b.gap = r2((b.gap || 0) * k); }
        if (b.type === "hissan") b.cell = r2(b.cell * k);
        if (b.type === "text") { b.size = r2(b.size * k); b.pad = r2(b.pad * k); }
        if (b.type === "shiki") b.size = r2(b.size * k);
        if (b.type === "line" || b.type === "rect") b.width = Math.max(0.1, r2(b.width * k));
      });
    });
  };

  /**
   * 用紙を変える。fit が true で、向きが同じなら、部品も紙に合わせて拡大・縮小する。
   * A4・B4・B5・A3 はたてよこの比が同じなので、はみ出さずにそのまま大きくなる。
   */
  App.setPaper = function (paper, orient, fit) {
    var d = App.doc, before = App.pageSize(), sameOrient = d.orient === orient;
    d.paper = App.PAPER[paper] ? paper : "A4";
    d.orient = orient === "landscape" ? "landscape" : "portrait";
    var after = App.pageSize();
    if (fit && sameOrient && before[0] !== after[0]) App.scaleDoc(d, after[0] / before[0]);
  };

  /** 外から紙面のデータを入れる（ファイルを開く、事例を開く、テスト）。 */
  App.loadDoc = function (obj) {
    var d = App.normalizeDoc(JSON.parse(JSON.stringify(obj)));
    if (!d) return false;
    if (App.stopEditing) App.stopEditing();
    App.doc = d;
    App.selId = null;
    App.commit();
    App.renderAll();
    App.fitWidth(1);
    App.renderPanel();
    App.syncHeader();
    if (App.warnMissingFonts) App.warnMissingFonts();
    return true;
  };

  /** 紙面の点検。紙からはみ出した部品、入りきらない字、解けない筆算を挙げる。 */
  App.inspect = function () {
    var size = App.pageSize(), out = [];
    App.doc.pages.forEach(function (pg, pi) {
      pg.blocks.forEach(function (b, i) {
        var r = App.bbox(b), name = (pi + 1) + "ページ目 " + App.TYPE_NAMES[b.type] + "#" + i;
        if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > size[0] + 0.5 || r.y + r.h > size[1] + 0.5) {
          out.push(name + "：紙からはみ出しています（x=" + r2(r.x) + " y=" + r2(r.y) + " w=" + r2(r.w) + " h=" + r2(r.h) + " ／ 紙 " + size[0] + "×" + size[1] + "）");
        }
        if (b.type === "masu") {
          var res = App.layouts[b.id];
          if (res && res.lines.length > b.lines) out.push(name + "：字が入りきっていません（必要 " + res.lines.length + "行 ／ いま " + b.lines + "行）");
        }
        if (b.type === "hissan") {
          var sol = Hissan.solve(b.expr, { zeroStep: b.zeroStep });
          if (!sol.ok) out.push(name + "：式「" + b.expr + "」を解けません（" + sol.error + "）");
        }
      });
    });
    return out;
  };

  // ---------- ひな形 ----------
  function baseDoc(title, orient, paper) {
    return { version: 1, title: title, paper: paper || "A4", orient: orient || "portrait", margin: 10, snap: 1, pages: [{ blocks: [] }] };
  }
  /** 1行ぶんの文字のわく。高さは字の大きさから決める（字の高さ×行の高さ＋上下の余白）。 */
  function lineH(size, lines) { return Math.ceil((size * 0.3528 * 1.6 * (lines || 1) + 3) * 2) / 2; }
  App.lineH = lineH;
  function label(x, y, w, size, html, extra) {
    return App.make.text(Object.assign({ x: x, y: y, w: w, h: lineH(size, (html.match(/<div>/g) || []).length + 1), size: size, html: html }, extra || {}));
  }
  function nameLine(x, y, w) { return label(x, y, w || 100, 12, "　年　組　名前（　　　　　　　　　　）"); }

  App.templates = {
    blank: { name: "白紙（A4 たて）", build: function () { return baseDoc("無題のプリント"); } },
    blankB4: { name: "白紙（B4 よこ）", build: function () { return baseDoc("無題のプリント", "landscape", "B4"); } },

    sample: {
      name: "見本（できることの一覧）",
      build: function () {
        var d = baseDoc("マス目プリントの見本");
        var B = d.pages[0].blocks;
        B.push(label(10, 10, 95, 20, "マス目プリントの見本", { bold: true }));
        B.push(nameLine(105, 11, 95));
        B.push(App.make.line({ x1: 10, y1: 23, x2: 200, y2: 23, width: 0.5 }));

        // 縦書きのマス目（文字入り）
        var text = "　きのう、にわで小さなかえるを見つけました。\n「ねえ、きみはどこから来たの。」\nと聞くと、かえるはにげて、はっぱのかげにかくれてしまいました。";
        var m = App.make.masu({ x: 120, y: 42, dir: "v", cell: 10, perLine: 12, lines: 8, text: text });
        var a = text.indexOf("かえる");
        m.styles = Masu.applyStyle([], text.length, a, a + 3, { color: "#1d5fbf" });
        var k = text.indexOf("はっぱのかげ");
        m.styles = Masu.applyStyle(m.styles, text.length, k, k + 6, { side: "single" });
        B.push(label(120, 28, 80, 10, "① 縦書きのマス目です。かぎや句読点は、<div>原稿用紙のきまりどおりに入ります。</div>"));
        B.push(m);

        // 横書きの記述らん（十字リーダー）
        B.push(label(10, 28, 100, 10, "② 字を入れなければ、そのまま記述欄になります。"));
        B.push(App.make.masu({ x: 10, y: 42, dir: "h", cell: 10, perLine: 10, lines: 3, leader: true, text: "" }));

        // なぞり書き
        B.push(label(10, 78, 100, 10, "③ うすい灰色にすると、なぞり書きになります。"));
        B.push(App.make.masu({ x: 10, y: 88, dir: "h", cell: 12.5, perLine: 8, lines: 1, leader: true, color: "#b9bcc0", fontScale: 0.88, text: "あさがおのたね" }));

        // 横書きのきまり
        B.push(label(10, 105, 100, 10, "④ 横書きでは、半角の数字が2字で1マスに入ります。"));
        B.push(App.make.masu({ x: 10, y: 116, dir: "h", cell: 10, perLine: 10, lines: 2, text: "2026年9月18日、はれ。" }));

        // 筆算と式
        B.push(label(10, 170, 190, 10, "⑤ 筆算は式を入れるだけです。問題だけを刷るときも、途中の計算を書く行まで方眼を取ります。"));
        B.push(App.make.hissan({ x: 10, y: 182, expr: "92÷4", mode: "problem" }));
        B.push(App.make.hissan({ x: 50, y: 182, expr: "92÷4", mode: "answer" }));
        B.push(App.make.hissan({ x: 90, y: 182, expr: "23×45", mode: "answer" }));
        B.push(App.make.hissan({ x: 140, y: 182, expr: "3.5+2.75", mode: "answer" }));

        B.push(label(10, 250, 190, 10, "⑥ 式は「1と2/3 + 3/4 = □」のように打つと、分数に組みます。"));
        B.push(App.make.rect({ x: 10, y: 260, w: 95, h: 22, shape: "round", color: "#8a8f96", width: 0.4 }));
        B.push(App.make.shiki({ x: 16, y: 264, src: "1と2/3 + 3/4 = □", size: 20 }));
        B.push(App.make.line({ x1: 110, y1: 271, x2: 135, y2: 271, arrow: "end", width: 0.6 }));
        B.push(label(138, 267, 62, 10, "線、矢印、図形も引けます。"));
        return d;
      }
    },

    sakubun: {
      name: "作文用紙（縦書き 20字×10行）",
      build: function () {
        var d = baseDoc("作文用紙", "landscape");
        var B = d.pages[0].blocks;
        B.push(App.make.masu({ x: 297 - 20 - 10 * 12 - 9 * 3, y: 25, dir: "v", cell: 8.5, perLine: 20, lines: 10, gap: 3, gridColor: "brown", text: "" }));
        B[0].x = 297 - 20 - (10 * 8.5 + 9 * 3);
        B.push(App.make.text({ x: 18, y: 25, w: 17, h: 150, dir: "v", size: 12, html: "題名（　　　　　　　　　　　　）　　名前（　　　　　　　　）" }));
        return d;
      }
    },

    shisha: {
      name: "視写プリント（手本と書くマス）",
      build: function () {
        var d = baseDoc("視写プリント");
        var B = d.pages[0].blocks;
        B.push(label(10, 10, 95, 18, "ていねいに うつしましょう", { bold: true }));
        B.push(nameLine(105, 11, 95));
        var t = "　あさ、まどをあけると、つめたい風が入ってきました。\n「さむいね。」\nと、いもうとが言いました。";
        B.push(label(150, 28, 50, 11, "手本"));
        B.push(App.make.masu({ x: 140, y: 38, dir: "v", cell: 12, perLine: 12, lines: 5, fontScale: 0.8, text: t }));
        B.push(label(60, 28, 60, 11, "ここに書きます"));
        B.push(App.make.masu({ x: 60, y: 38, dir: "v", cell: 12, perLine: 12, lines: 5, leader: true, autoGrow: false, text: "" }));
        return d;
      }
    },

    hissan6: {
      name: "筆算プリント（わり算 6問）",
      build: function () {
        var d = baseDoc("わり算の筆算");
        var B = d.pages[0].blocks;
        B.push(label(10, 10, 95, 18, "わり算の筆算", { bold: true }));
        B.push(nameLine(105, 11, 95));
        var exprs = ["84÷4", "95÷4", "72÷3", "816÷4", "635÷5", "252÷36"];
        exprs.forEach(function (ex, i) {
          var col = i % 3, row = Math.floor(i / 3);
          var x = 10 + col * 65, y = 40 + row * 110;
          B.push(label(x, y - 11, 40, 13, "（" + (i + 1) + "）"));
          B.push(App.make.hissan({ x: x + 5, y: y, expr: ex, mode: "problem" }));
        });
        return d;
      }
    }
  };
})();
