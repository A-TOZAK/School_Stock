/* マス目プリントメーカー：外から来た紙面のデータを、画面に入れる前に確かめる
 * 紙面のファイル（.json）は、人からもらうことがある。中の値は、そのまま CSS や画像の行き先に入るので、
 * 決まった形の値だけを通し、そうでないものは既定の値に置きかえる。
 *   - 色：#rgb / #rrggbb / #rrggbbaa と none だけ
 *   - 数：有限の数だけ。上限と下限をつける
 *   - 画像：data:image/…;base64 だけ（外のサーバーの画像は読みに行かない）
 *   - 決まった言葉から選ぶ値：その言葉だけ
 *   - ページは50まで、1ページの部品は400まで、字は1つの部品で2万字まで
 */
(function () {
  "use strict";
  var App = window.App;
  var COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  var IMG = /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;
  var MAX_PAGES = 50, MAX_BLOCKS = 400, MAX_TEXT = 20000;

  function color(v, def, allowNone) { return (allowNone && v === "none") || (typeof v === "string" && COLOR.test(v)) ? v : def; }
  function num(v, def, lo, hi) { v = typeof v === "string" ? parseFloat(v) : v; return typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function pick(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function font(v) {
    if (typeof v === "string" && has(App.FONTS, v)) return v;
    if (typeof v === "string" && v.indexOf("local:") === 0) {
      var n = v.slice(6).replace(/[^\p{L}\p{N} ._\-()（）・]/gu, "").slice(0, 80);
      if (n) return "local:" + n;
    }
    return "kyokasho";
  }

  function clean(b) {
    var d = App.make[b.type]({});   // 既定の値
    b.id = typeof b.id === "string" && /^[\w-]{1,40}$/.test(b.id) ? b.id : App.uid();
    if (b.type === "line") {
      ["x1", "y1", "x2", "y2"].forEach(function (k) { b[k] = num(b[k], d[k], -200, 700); });
    } else {
      b.x = num(b.x, d.x, -200, 700); b.y = num(b.y, d.y, -200, 700);
      if ("w" in b) b.w = num(b.w, d.w || 60, 1, 700);
      if ("h" in b) b.h = num(b.h, d.h || 20, 1, 700);
    }
    if ("font" in b) b.font = font(b.font);
    if ("color" in b) b.color = color(b.color, d.color || "#1b1b1b");
    switch (b.type) {
      case "masu":
        b.dir = pick(b.dir, ["v", "h"], "v");
        b.cell = num(b.cell, 10, 3, 60); b.perLine = Math.round(num(b.perLine, 12, 1, 80)); b.lines = Math.round(num(b.lines, 8, 1, 80));
        b.gap = num(b.gap, 0, 0, 40); b.fontScale = num(b.fontScale, 0.78, 0.3, 1);
        b.lineStyle = pick(b.lineStyle, ["solid", "dotted", "none"], "solid");
        b.gridColor = typeof b.gridColor === "string" && has(App.GRID_COLORS, b.gridColor) ? b.gridColor : "green";
        b.text = str(b.text, MAX_TEXT);
        b.styles = Array.isArray(b.styles) ? b.styles.slice(0, MAX_TEXT).map(function (s) {
          if (!s || typeof s !== "object") return null;
          var o = {};
          if (s.color && COLOR.test(s.color)) o.color = s.color;
          if (s.bold) o.bold = true;
          if (s.box) o.box = true;
          if (["single", "double", "wave"].indexOf(s.side) >= 0) o.side = s.side;
          return Object.keys(o).length ? o : null;
        }) : [];
        var r = b.rules || {};
        b.rules = { kutenKagi: !!r.kutenKagi, gyotou: pick(r.gyotou, ["in", "out", "off"], "in"), kaiwaSage: !!r.kaiwaSage, danrakuSage: !!r.danrakuSage, hankaku2: !!r.hankaku2 };
        break;
      case "text":
        b.dir = pick(b.dir, ["h", "v"], "h");
        b.html = App.cleanHtml ? App.cleanHtml(str(b.html, MAX_TEXT * 4)) : "";
        b.size = num(b.size, 12, 4, 200); b.pad = num(b.pad, 1.5, 0, 30); b.lineHeight = num(b.lineHeight, 1.6, 0.8, 4);
        b.align = pick(b.align, ["start", "center", "end"], "start");
        b.border = pick(b.border, ["none", "solid", "dotted", "bold"], "none");
        b.fill = color(b.fill, "none", true);
        break;
      case "line":
        b.width = num(b.width, 0.5, 0.05, 10);
        b.dash = pick(b.dash, ["solid", "dash", "dot"], "solid");
        b.arrow = pick(b.arrow, ["none", "end", "both"], "none");
        break;
      case "rect":
        b.width = num(b.width, 0.5, 0, 10);
        b.dash = pick(b.dash, ["solid", "dash", "dot"], "solid");
        b.shape = pick(b.shape, ["rect", "round", "ellipse"], "rect");
        b.fill = color(b.fill, "none", true);
        break;
      case "hissan":
        b.expr = str(b.expr, 60); b.cell = num(b.cell, 10, 3, 40); b.spare = Math.round(num(b.spare, 0, 0, 20));
        b.mode = pick(b.mode, ["problem", "answer"], "problem");
        b.zeroStep = pick(b.zeroStep, ["skip", "write"], "skip");
        b.grid = pick(b.grid, ["hougan", "masu", "none"], "hougan");
        b.ansColor = color(b.ansColor, "#d12a1e");
        break;
      case "shiki":
        b.src = str(b.src, 200); b.size = num(b.size, 16, 4, 200);
        break;
      case "image":
        b.src = typeof b.src === "string" && IMG.test(b.src) ? b.src : "";
        break;
    }
    return b;
  }

  var base = App.normalizeDoc;
  App.normalizeDoc = function (d) {
    d = base(d);
    if (!d) return d;
    d.title = str(d.title, 120) || "無題のプリント";
    d.margin = num(d.margin, 10, 0, 40);
    d.snap = num(d.snap, 1, 0.1, 20);
    d.pages = d.pages.slice(0, MAX_PAGES);
    d.pages.forEach(function (pg) {
      pg.blocks = pg.blocks.slice(0, MAX_BLOCKS).map(clean).filter(function (b) { return b.type !== "image" || b.src; });
    });
    return d;
  };
})();
