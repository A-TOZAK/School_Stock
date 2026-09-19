/* マス目プリントメーカー：自動で組むひな形（漢字練習、ノートのマス）
 * 紙面のデータ（doc）を返す関数と、その入力の画面。app-start.js より前に読みこむ。
 */
(function () {
  "use strict";
  var App = window.App, h = App.h;
  var GRAY = "#b9bcc0";

  function paperSize(paper, orient) {
    var P = App.PAPER[paper] || App.PAPER.A4;
    return orient === "landscape" ? [P[1], P[0]] : [P[0], P[1]];
  }
  function text(x, y, w, size, html, extra) {
    return App.make.text(Object.assign({ x: x, y: y, w: w, h: App.lineH(size, 1), size: size, html: html }, extra || {}));
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  /** 見出しと名前らんと下の線。返すのは、その下から使える y（mm）。 */
  function header(blocks, pw, m, title, withName) {
    var tw = withName ? pw - m * 2 - 102 : pw - m * 2;
    var ts = Math.max(10, Math.min(18, Math.floor((tw - 3) / (Math.max(1, title.length) * 0.3528 * 1.06))));
    blocks.push(text(m, 10 + (18 - ts) * 0.3, tw, ts, esc(title), { bold: true }));
    if (withName) blocks.push(text(pw - m - 100, 11, 100, 12, "　年　組　名前（　　　　　　　　　　）"));
    blocks.push(App.make.line({ x1: m, y1: 23, x2: pw - m, y2: 23, width: 0.5 }));
    return 30;
  }
  function chars(s) {
    if (window.Intl && Intl.Segmenter) return Array.from(new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(s), function (x) { return x.segment; });
    return Array.from(s);
  }

  // ====================================================================
  // 漢字練習
  // ====================================================================
  /** 1行を「ことば」と「よみ」に分ける。「学校 がっこう」「学校（がっこう）」「学校」のどれでもよい。 */
  App.parseKanjiLine = function (line) {
    line = String(line || "").trim();
    if (!line) return null;
    var m = line.match(/^(.+?)[\s　]*[（(]([^）)]*)[）)]\s*$/) || line.match(/^(\S+)[\s　]+(.+)$/);
    return m ? { w: m[1].trim(), yomi: m[2].trim() } : { w: line, yomi: "" };
  };

  /** o = { title, words[文字列], paper, orient, cell, nazori（なぞる回数）, tehon（手本を置くか）, leader }
   *  たてに1列＝1つのことば。右から左へ並べる。右わきに、よみがなを小さく置く。 */
  App.buildKanji = function (o) {
    o = Object.assign({ title: "漢字の練習", words: [], paper: "A4", orient: "portrait", cell: 18, nazori: 2, leader: true, gridColor: "green" }, o || {});
    var size = paperSize(o.paper, o.orient), pw = size[0], ph = size[1], m = 12, c = o.cell;
    // よみがなのらんの幅は、字の大きさから決める（わくが自動で広がらない幅）
    var ys = c >= 18 ? 10 : 9, yomiW = App.lineH(ys, 1) + 0.5, gap = 2, pitch = c + yomiW + gap;
    var items = o.words.map(App.parseKanjiLine).filter(Boolean);
    var pages = [], blocks = null, top = 0, n = 0, perPage = Math.max(1, Math.floor((pw - m * 2 + gap) / pitch));

    items.forEach(function (it, i) {
      if (!blocks || n >= perPage) {
        blocks = []; pages.push({ blocks: blocks }); n = 0;
        top = pages.length === 1 ? header(blocks, pw, m, o.title, true) : m;
      }
      var cells = Math.max(3, Math.floor((ph - top - m) / c));
      var w = chars(it.w), len = w.length, reps = Math.min(1 + o.nazori, Math.max(1, Math.floor(cells / len)));
      var body = "", k;
      for (k = 0; k < reps; k++) body += it.w;
      var styles = Masu.applyStyle([], body.length, it.w.length, body.length, { color: GRAY });
      var x = pw - m - yomiW - c - pitch * n;
      blocks.push(App.make.masu({
        x: Math.round(x * 2) / 2, y: top, dir: "v", cell: c, perLine: cells, lines: 1, gap: 0, leader: o.leader, gridColor: o.gridColor,
        text: body, styles: reps > 1 ? styles : [], fontScale: 0.8, autoGrow: false,
        rules: { kutenKagi: false, gyotou: "off", kaiwaSage: false, danrakuSage: false, hankaku2: false }
      }));
      if (it.yomi) {
        blocks.push(App.make.text({ x: Math.round((x + c + 0.5) * 2) / 2, y: top, w: yomiW, h: Math.min(cells * c, Math.max(c, chars(it.yomi).length * ys * 0.3528 * 1.12 + 4)), dir: "v", size: ys, html: esc(it.yomi), pad: 1 }));
      }
      n++;
    });
    if (!pages.length) pages.push({ blocks: [] });
    return { doc: { version: 1, title: o.title, paper: o.paper, orient: o.orient, margin: 10, snap: 1, pages: pages }, count: items.length, perPage: perPage };
  };

  // ====================================================================
  // ノートのマス
  // ====================================================================
  /** ノートのマス1枚。本人のノートプリント（School Stock の 03 ノートプリント）を採寸した形。
   *  o = { title, paper, orient, dir, cell, perLine（字が進む向きのマスの数）, lines（行の数）, gap（行のあいだ mm）,
   *        leader, gridColor, sides（1か2）, split（"h"=左右に2面、"v"=上下に2面）, between（面のあいだ mm）,
   *        top（マスの上はし mm）, kana（名前らんをひらがなにする）, date（日付のらん）, headRow（1行目に入れる見出しの字） } */
  App.buildNote = function (o) {
    o = Object.assign({ title: "ノートのマス", paper: "B4", orient: "landscape", dir: "h", cell: 10, perLine: 10, lines: 10, gap: 0,
      leader: true, gridColor: "green", sides: 1, split: "h", between: 24, top: 22, kana: true, date: true, headRow: "" }, o || {});
    var size = paperSize(o.paper, o.orient), pw = size[0], ph = size[1], c = o.cell, blocks = [];
    var W = o.dir === "v" ? o.lines * c + (o.lines - 1) * o.gap : o.perLine * c;
    var H = o.dir === "v" ? o.perLine * c : o.lines * c + (o.lines - 1) * o.gap;
    var nx = o.sides === 2 && o.split === "h" ? 2 : 1, ny = o.sides === 2 && o.split === "v" ? 2 : 1;
    var x0 = (pw - (W * nx + o.between * (nx - 1))) / 2;
    var green = (App.GRID_COLORS[o.gridColor] || App.GRID_COLORS.green).solid;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var x = Math.round((x0 + (W + o.between) * i) * 2) / 2, y = Math.round((o.top + (H + o.between) * j) * 2) / 2;
      blocks.push(text(x, y - 13, Math.min(W * 0.6, 95), 14, o.kana ? "なまえ（　　　　　　　　　）" : "名前（　　　　　　　　　）"));
      if (o.date) blocks.push(text(x + W - 52, y - 10, 52, 10, o.kana ? "　がつ　　にち　　ようび" : "　　月　　日（　　）", { align: "end" }));
      var m = App.make.masu({ x: x, y: y, dir: o.dir, cell: c, perLine: o.perLine, lines: o.lines, gap: o.gap, leader: o.leader, gridColor: o.gridColor,
        text: o.headRow || "", autoGrow: false, fontScale: 0.72 });
      if (o.headRow) { m.color = green; m.styles = Masu.applyStyle([], o.headRow.length, 0, o.headRow.length, { bold: true }); }
      blocks.push(m);
    }
    return { doc: { version: 1, title: o.title, paper: o.paper, orient: o.orient, margin: 10, snap: 0.5, pages: [{ blocks: blocks }] } };
  };

  /** 漢字・熟語 学習プリント（B4 よこ）。左に「熟語・意味・文」の表、右に18mmのマス（たて11マス×10行）。 */
  App.buildJukugo = function () {
    var B = [], pw = 364, L = 13.5, top = 42, bottom = 240, tblR = 118.5, labX = 110.5, dashX = 93;
    function vtext(x, y, w, hh, size, html, extra) { return App.make.text(Object.assign({ x: x, y: y, w: w, h: hh, dir: "v", size: size, html: html, pad: 1 }, extra || {})); }
    function line(x1, y1, x2, y2, extra) { return App.make.line(Object.assign({ x1: x1, y1: y1, x2: x2, y2: y2, width: 0.4 }, extra || {})); }
    // 名前と、熟語の説明
    B.push(App.make.rect({ x: L, y: 10, w: 184.5, h: 22, width: 0.4 }));
    B.push(text(L + 4, 12.5, 60, 30, "名前", { bold: true }));
    B.push(App.make.rect({ x: L + 184.5, y: 10, w: pw - L * 2 - 184.5, h: 22, width: 0.6 }));
    B.push(text(L + 187, 10.2, 140, 11, "熟語（じゅくご）とは？", { bold: true }));
    B.push(text(L + 187, 19.8, 148, 9, "二つ以上の単語または２字以上の漢字がくっついてできた言葉のこと。<div>例えば、「夜明け」「買物」「読書」など。</div>", { h: 12, lineHeight: 1.4 }));
    // 左の表
    B.push(App.make.rect({ x: L, y: top, w: tblR - L, h: bottom - top, width: 0.5 }));
    B.push(line(L, 70, tblR, 70)); B.push(line(L, 132, tblR, 132));
    B.push(line(labX, top, labX, bottom)); B.push(line(dashX, top, dashX, bottom, { dash: "dash" }));
    B.push(vtext(labX + 0.3, top + 1, 7.7, 26, 10, "熟語"));
    B.push(vtext(labX + 0.3, 71, 7.7, 30, 10, "意味"));
    B.push(vtext(labX + 0.3, 133, 7.7, 70, 10, "熟語を使ってつくった文"));
    B.push(vtext(dashX + 3, top + 2, 11.5, 26, 16, "読書"));
    B.push(vtext(dashX + 5, 73, 8.5, 50, 11, "本を読むこと。"));
    B.push(vtext(dashX + 5, 135, 8.5, 100, 11, "明日は、雨がふるので家で読書する。"));
    // 指示の文と、マス
    B.push(vtext(122.5, top, 10.5, 196, 14, "国語辞典を使って熟語の意味を調べ、文をつくってみましょう。", { bold: true }));
    B.push(App.make.masu({ x: 144, y: top, dir: "v", cell: 18, perLine: 11, lines: 10, gap: 0, leader: true, gridColor: "green", text: "", autoGrow: false }));
    B.push(vtext(328, top, 21, 198, 14, "分からなかった漢字の練習をしたり、教科書や漢字スキルの熟語を<div>見て漢字の練習をしましょう。</div>", { bold: true, lineHeight: 1.5 }));
    return { doc: { version: 1, title: "漢字・熟語 学習プリント", paper: "B4", orient: "landscape", margin: 10, snap: 0.5, pages: [{ blocks: B }] } };
  };

  /** はじめの画面に出すノート。名前と並びは、配布中の棚（School Stock の tools/note-prints）と同じ。
   *  大きさと数は、実物の PDF を測った値。 */
  App.NOTE_SHEETS = [
    { key: "hougan", name: "5mm方眼ノート（B4）", note: "教科を選ばない方眼の1枚。10mmのマスに、5mmの点線が入ります。",
      opts: { title: "5mm方眼ノート", paper: "B4", orient: "landscape", dir: "h", cell: 10, perLine: 33, lines: 22, leader: true, sides: 1, top: 24, kana: false, date: true } },
    { key: "kokugo8", name: "こくご 8マスノート", note: "27mmの大きなマス。たて8マスが6行で、2面あります。",
      opts: { title: "こくご 8マスノート", paper: "B4", orient: "landscape", dir: "v", cell: 26.8, perLine: 8, lines: 6, gap: 0, leader: true, sides: 2, split: "h", between: 10.5, top: 23.5 } },
    { key: "sansu10", name: "さんすう 10×6マスノート", note: "22mmのマス。1から10の見出しつきで、2面あります。",
      opts: { title: "さんすう 10×6マスノート", paper: "B4", orient: "portrait", dir: "h", cell: 22, perLine: 10, lines: 7, leader: true, sides: 2, split: "v", between: 22, top: 22, headRow: "１２３４５６７８９10" } },
    { key: "sansu12", name: "さんすう 12×7マスノート", note: "19mmのマス。1から10と、＋、－の見出しつきで、2面あります。",
      opts: { title: "さんすう 12×7マスノート", paper: "B4", orient: "portrait", dir: "h", cell: 19, perLine: 12, lines: 8, leader: true, sides: 2, split: "v", between: 22, top: 22, headRow: "１２３４５６７８９10＋－" } },
    { key: "sansu15", name: "さんすう 10×14マスノート", note: "15mmのマス。点線のない、はっきりしたマスが2面あります。",
      opts: { title: "さんすう 10×14マスノート", paper: "B4", orient: "landscape", dir: "h", cell: 15, perLine: 10, lines: 15, leader: false, sides: 2, split: "h", between: 24, top: 22 } },
    { key: "kokugo", name: "低学年 作文ノート", note: "18mmのマス。たて12マスが7行（84字）で、2面あります。行の右に、ふりがなのすきまがあります。",
      opts: { title: "低学年 作文ノート", paper: "B4", orient: "landscape", dir: "v", cell: 18, perLine: 12, lines: 7, gap: 5.8, leader: true, sides: 2, split: "h", between: 22, top: 23.5 } },
    { key: "jukugo", name: "漢字・熟語 学習プリント", note: "熟語の意味と文を書く表と、18mmの練習マスが1枚になっています。",
      build: function () { return App.buildJukugo(); } }
  ];
  /** ノートの紙面を作る。 */
  App.noteDoc = function (s) { return (s.build ? s.build() : App.buildNote(s.opts)).doc; };
})();
