/* app-render.js — 紙面と部品を画面に描く。 */
(function () {
  "use strict";
  var App = window.App, h = App.h, s = App.s;

  var INK = "#1b1b1b";

  // ---------- 紙 ----------
  App.renderAll = function () {
    var host = App.$("#pages");
    host.innerHTML = "";
    App.layouts = {};
    var n = App.doc.pages.length;
    App.doc.pages.forEach(function (pg, pi) { host.appendChild(buildPage(pg, pi, n)); });
    host.appendChild(h("div", { class: "add-row no-print" },
      h("button", { class: "add-page add-copy", type: "button", title: "いちばん下のページと同じものを、もう1ページ足します", onclick: function () { App.addPage(n - 1); } }, "＋ 同じ形のページを追加"),
      h("button", { class: "add-page add-blank", type: "button", onclick: function () { App.addPage(); } }, "＋ 白紙のページを追加")));
    updatePageRule();
    App.applyScale();
    App.measureAuto();
    App.drawSelection();
  };

  function buildPage(pg, pi, n) {
    var size = App.pageSize(), m = App.doc.margin;
    var wrap = h("div", { class: "page-wrap", "data-page": pi });
    var page = h("div", { class: "page", style: "width:" + size[0] + "mm;height:" + size[1] + "mm" });
    if (m > 0) page.appendChild(h("div", { class: "guide no-print", style: "left:" + m + "mm;top:" + m + "mm;right:" + m + "mm;bottom:" + m + "mm" }));
    pg.blocks.forEach(function (b) { page.appendChild(App.buildBlock(b)); });
    wrap.appendChild(page);
    var tag = h("div", { class: "page-tag no-print" }, (pi + 1) + " / " + n);
    tag.appendChild(h("button", { type: "button", class: "dup", title: "このページと同じものを、すぐ下に足す", onclick: function () { App.addPage(pi); } }, "複製"));
    if (n > 1) tag.appendChild(h("button", { type: "button", title: "このページを消す", onclick: function () { App.removePage(pi); } }, "消す"));
    wrap.appendChild(tag);
    return wrap;
  }

  function updatePageRule() {
    var size = App.pageSize();
    App.$("#page-rule").textContent = "@page{size:" + size[0] + "mm " + size[1] + "mm;margin:0}";
  }

  App.applyScale = function () {
    var size = App.pageSize(), sc = App.scale;
    document.querySelectorAll(".page-wrap").forEach(function (w) {
      w.style.width = size[0] * App.MM * sc + "px";
      w.style.height = size[1] * App.MM * sc + "px";
      w.firstChild.style.transform = "scale(" + sc + ")";
    });
    var z = App.$("#zoom-val");
    if (z) z.textContent = Math.round(sc * 100) + "%";
  };

  App.pageEl = function (pi) { return App.$('.page-wrap[data-page="' + pi + '"] .page'); };
  App.blockEl = function (id) { return App.$('.blk[data-id="' + id + '"]'); };
  /** 画面の1mmが何pxか（拡大率こみ）。 */
  App.pxPerMm = function (pageEl) { return pageEl.getBoundingClientRect().width / App.pageSize()[0]; };

  // ---------- 部品 ----------
  App.buildBlock = function (b) {
    var el = h("div", { class: "blk " + b.type, "data-id": b.id });
    App.fillBlock(el, b);
    return el;
  };

  /** 部品の中身を描きなおす。 */
  App.refreshBlock = function (b) {
    var el = App.blockEl(b.id);
    if (el) App.fillBlock(el, b);
  };

  App.fillBlock = function (el, b) {
    if (b.type === "masu") fillMasu(el, b);
    else if (b.type === "text") fillText(el, b);
    else if (b.type === "line") fillLine(el, b);
    else if (b.type === "rect") fillRect(el, b);
    else if (b.type === "hissan") fillHissan(el, b);
    else if (b.type === "shiki") fillShiki(el, b);
    else if (b.type === "image") fillImage(el, b);
    App.placeBlock(el, b);
  };

  /** 部品の外わく（mm）。線は両はしから求める。 */
  App.bbox = function (b) {
    if (b.type === "line") {
      var pad = 3;
      var x = Math.min(b.x1, b.x2) - pad, y = Math.min(b.y1, b.y2) - pad;
      return { x: x, y: y, w: Math.abs(b.x2 - b.x1) + pad * 2, h: Math.abs(b.y2 - b.y1) + pad * 2 };
    }
    return { x: b.x, y: b.y, w: b.w || 10, h: b.h || 10 };
  };

  App.placeBlock = function (el, b) {
    var r = App.bbox(b);
    el.style.left = r.x + "mm";
    el.style.top = r.y + "mm";
    if (b.type === "shiki") { el.style.width = ""; el.style.height = ""; }
    else { el.style.width = r.w + "mm"; el.style.height = r.h + "mm"; }
  };

  /** 式のように中身で大きさが決まる部品を、描いたあとで測る。 */
  App.measureAuto = function () {
    document.querySelectorAll(".blk.shiki").forEach(function (el) {
      var f = App.find(el.dataset.id);
      if (!f) return;
      f.block.w = el.offsetWidth / App.MM;
      f.block.h = el.offsetHeight / App.MM;
    });
    document.querySelectorAll(".blk.text").forEach(function (el) {
      var f = App.find(el.dataset.id);
      if (f) App.fitTextBlock(f.block, el);
    });
  };

  /** 文字がわくからあふれたら、わくのほうを広げる（横書きは下へ、縦書きは左へ）。 */
  App.fitTextBlock = function (b, el) {
    el = el || App.blockEl(b.id);
    var tx = el && el.querySelector(".tx");
    if (!tx) return false;
    var changed = false;
    if (b.dir === "v") {
      var w = Math.ceil(tx.offsetWidth / App.MM * 10) / 10;
      if (w > b.w + 0.2) { b.x = Math.round((b.x - (w - b.w)) * 10) / 10; b.w = w; changed = true; }
    } else {
      var hh = Math.ceil(tx.offsetHeight / App.MM * 10) / 10;
      if (hh > b.h + 0.2) { b.h = hh; changed = true; }
    }
    if (changed) App.placeBlock(el, b);
    return changed;
  };

  // ---------- マス目 ----------
  App.masuGeom = function (b) {
    var c = b.cell, g = b.gap || 0, W, H, xy;
    if (b.dir === "v") {
      W = b.lines * c + (b.lines - 1) * g; H = b.perLine * c;
      xy = function (L, P) { return [W - (L + 1) * c - L * g, P * c]; };
    } else {
      W = b.perLine * c; H = b.lines * c + (b.lines - 1) * g;
      xy = function (L, P) { return [P * c, L * (c + g)]; };
    }
    return { W: W, H: H, xy: xy };
  };

  /** 行数をふやす。縦書きは左へのびるので、右はしを動かさない。 */
  App.setMasuLines = function (b, n) {
    n = App.clamp(n | 0, 1, 80);
    if (b.dir === "v") {
      var before = App.masuGeom(b).W;
      b.lines = n;
      b.x = Math.round((b.x - (App.masuGeom(b).W - before)) * 100) / 100;
    } else b.lines = n;
  };

  function fillMasu(el, b) {
    var res = Masu.layout(b.text, { perLine: b.perLine, dir: b.dir, rules: b.rules });
    if (b.autoGrow !== false && res.lines.length > b.lines) App.setMasuLines(b, res.lines.length);
    App.layouts[b.id] = res;
    var g = App.masuGeom(b);
    b.w = g.W; b.h = g.H;

    el.className = "blk masu " + b.dir;
    el.innerHTML = "";
    el.appendChild(gridSvg(b, g));

    var fs = Math.round(b.cell * b.fontScale * 100) / 100;
    var cells = h("div", { class: "cells", style: "font-family:" + App.fontCss(b.font) + ";color:" + b.color + ";font-size:" + fs + "mm" });
    res.lines.forEach(function (ln, L) {
      if (L >= b.lines) return;
      ln.cells.forEach(function (c, P) {
        if (!c || c.type === "indent") return;
        cells.appendChild(cellEl(b, g, c, L, P));
      });
    });
    el.appendChild(cells);
    el.appendChild(marksSvg(b, g, res));
    el.appendChild(h("div", { class: "ov no-print" }));
    if (res.lines.length > b.lines) {
      el.appendChild(h("div", { class: "overflow no-print" }, "入りきらない字があります（行数をふやすと入ります）"));
    }
  }

  function styleAt(b, part) { return (b.styles && b.styles[part.i]) || null; }

  function cellEl(b, g, c, L, P) {
    var xy = g.xy(L, P);
    var st = styleAt(b, c.parts[0]) || {};
    var css = "left:" + xy[0] + "mm;top:" + xy[1] + "mm;width:" + b.cell + "mm;height:" + b.cell + "mm;";
    if (st.color) css += "color:" + st.color + ";";
    if (st.bold) css += "font-weight:700;";
    var d = h("div", { class: "mc", style: css, "data-l": L, "data-p": P });
    var main = h("span", { class: "ch" });
    if (c.type === "kk") {
      c.parts.forEach(function (p) { main.appendChild(h("span", { class: "hf" }, p.ch)); });
    } else if (c.type === "tcy") {
      main.appendChild(h("span", { class: "tcy" }, c.parts.map(function (p) { return p.ch; }).join("")));
    } else if (c.type === "half") {
      main.appendChild(h("span", { class: "up" }, c.parts[0].ch));
    } else if (c.type === "pair") {
      main.appendChild(h("span", { class: "pair" }, c.parts.map(function (p) { return p.ch; }).join("")));
    } else {
      main.textContent = c.parts.map(function (p) { return p.ch; }).join("");
    }
    d.appendChild(main);
    if (c.hang.length) {
      var out = b.rules.gyotou === "out";
      d.classList.add(out ? "has-hang-out" : "has-hang");
      var hs = styleAt(b, c.hang[0]) || {};
      var hang = h("span", { class: "hang " + (out ? "out" : "in") + (c.hang.length > 1 ? " multi" : ""), style: hs.color ? "color:" + hs.color : null });
      c.hang.forEach(function (p) { hang.appendChild(h("span", { class: c.hang.length > 1 ? "hf" : "" }, p.ch)); });
      d.appendChild(hang);
    }
    return d;
  }

  function gridSvg(b, g) {
    var col = App.GRID_COLORS[b.gridColor] || App.GRID_COLORS.green;
    var svg = s("svg", { class: "grid", viewBox: "0 0 " + g.W + " " + g.H, preserveAspectRatio: "none" });
    if (b.lineStyle === "none") return svg;
    var c = b.cell, n = b.perLine, solid = "", dots = "", frames = "";
    for (var L = 0; L < b.lines; L++) {
      var o = g.xy(L, 0), x0 = o[0], y0 = o[1], P;
      if (b.dir === "v") {
        frames += "M" + x0 + " 0h" + c + "v" + n * c + "h" + -c + "z";
        for (P = 1; P < n; P++) solid += "M" + x0 + " " + P * c + "h" + c;
        if (b.leader) {
          dots += "M" + (x0 + c / 2) + " 0v" + n * c;
          for (P = 0; P < n; P++) dots += "M" + x0 + " " + (P * c + c / 2) + "h" + c;
        }
      } else {
        frames += "M0 " + y0 + "h" + n * c + "v" + c + "h" + -n * c + "z";
        for (P = 1; P < n; P++) solid += "M" + P * c + " " + y0 + "v" + c;
        if (b.leader) {
          dots += "M0 " + (y0 + c / 2) + "h" + n * c;
          for (P = 0; P < n; P++) dots += "M" + (P * c + c / 2) + " " + y0 + "v" + c;
        }
      }
    }
    var dash = b.lineStyle === "dotted" ? "0.8 0.9" : null;
    if (dots) svg.appendChild(s("path", { d: dots, fill: "none", stroke: col.dot, "stroke-width": 0.3, "stroke-dasharray": "0.6 1.5" }));
    svg.appendChild(s("path", { d: solid + frames, fill: "none", stroke: col.solid, "stroke-width": 0.32, "stroke-dasharray": dash }));
    if (b.frame) {
      var fr = (b.gap || 0) > 0 ? frames : "M0 0h" + g.W + "v" + g.H + "h" + -g.W + "z";
      svg.appendChild(s("path", { d: fr, fill: "none", stroke: col.solid, "stroke-width": 0.7, "stroke-linejoin": "miter" }));
    }
    return svg;
  }

  /** 傍線と囲み。 */
  function marksSvg(b, g, res) {
    var svg = s("svg", { class: "marks", viewBox: "0 0 " + g.W + " " + g.H, preserveAspectRatio: "none" });
    var c = b.cell;
    res.lines.forEach(function (ln, L) {
      if (L >= b.lines) return;
      var run = null;
      function flush() {
        if (!run) return;
        drawSide(svg, b, g, L, run.from, run.to, run.kind, run.color);
        run = null;
      }
      ln.cells.forEach(function (cell, P) {
        var st = cell && cell.parts.length ? styleAt(b, cell.parts[0]) : null;
        if (st && st.box) {
          var xy = g.xy(L, P);
          svg.appendChild(s("rect", { x: xy[0] + 0.3, y: xy[1] + 0.3, width: c - 0.6, height: c - 0.6, fill: "#fff", stroke: INK, "stroke-width": 0.6 }));
        }
        var kind = st && st.side ? st.side : null;
        var color = (st && st.color) || INK;
        if (kind && run && run.kind === kind && run.color === color && run.to === P - 1) run.to = P;
        else { flush(); if (kind) run = { from: P, to: P, kind: kind, color: color }; }
      });
      flush();
    });
    return svg;
  }

  function drawSide(svg, b, g, L, from, to, kind, color) {
    var c = b.cell, a = g.xy(L, from), z = g.xy(L, to);
    var inset = c * 0.055, sw = Math.max(0.3, c * 0.035);
    function seg(off) {
      if (b.dir === "v") return { x1: a[0] + c - off, y1: a[1] + c * 0.04, x2: a[0] + c - off, y2: z[1] + c * 0.96 };
      return { x1: a[0] + c * 0.04, y1: a[1] + c - off, x2: z[0] + c * 0.96, y2: a[1] + c - off };
    }
    if (kind === "wave") {
      var p = seg(inset + c * 0.02), amp = c * 0.035, wl = c * 0.22, d = "M" + p.x1 + " " + p.y1;
      var len = b.dir === "v" ? p.y2 - p.y1 : p.x2 - p.x1, nw = Math.max(1, Math.round(len / wl)), step = len / nw;
      for (var i = 0; i < nw; i++) {
        var sgn = i % 2 ? -1 : 1;
        if (b.dir === "v") d += "q" + sgn * amp * 2 + " " + step / 2 + " 0 " + step;
        else d += "q" + step / 2 + " " + sgn * amp * 2 + " " + step + " 0";
      }
      svg.appendChild(s("path", { d: d, fill: "none", stroke: color, "stroke-width": sw, "stroke-linecap": "round" }));
      return;
    }
    var offs = kind === "double" ? [inset, inset + c * 0.06] : [inset];
    offs.forEach(function (o) {
      var q = seg(o);
      svg.appendChild(s("line", { x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2, stroke: color, "stroke-width": sw }));
    });
  }

  // ---------- 文字 ----------
  function fillText(el, b) {
    var border = { none: "none", solid: "0.35mm solid " + INK, dotted: "0.35mm dotted " + INK, bold: "0.8mm solid " + INK }[b.border] || "none";
    var tx = el.querySelector(".tx");
    if (!tx) {
      el.innerHTML = "";
      tx = h("div", { class: "tx", spellcheck: "false" });
      tx.innerHTML = App.cleanHtml(b.html);
      el.appendChild(tx);
    }
    el.className = "blk text " + b.dir;
    tx.style.cssText = "font-family:" + App.fontCss(b.font) + ";font-size:" + b.size + "pt;color:" + b.color +
      ";font-weight:" + (b.bold ? 700 : 400) + ";text-align:" + b.align + ";line-height:" + b.lineHeight +
      ";padding:" + b.pad + "mm;border:" + border + ";background:" + (b.fill === "none" ? "transparent" : b.fill) +
      ";writing-mode:" + (b.dir === "v" ? "vertical-rl" : "horizontal-tb");
  }

  /** 文字の部品に入れてよいタグだけを残す。 */
  App.cleanHtml = function (html) {
    var t = document.createElement("template");
    t.innerHTML = html || "";
    var OK = { B: 1, I: 1, U: 1, SPAN: 1, FONT: 1, BR: 1, DIV: 1, STRONG: 1, EM: 1 };
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 8) { node.removeChild(n); return; }
        if (n.nodeType !== 1) return;
        walk(n);
        if (!OK[n.tagName]) {
          while (n.firstChild) node.insertBefore(n.firstChild, n);
          node.removeChild(n);
          return;
        }
        var color = n.style && n.style.color, weight = n.style && n.style.fontWeight, deco = n.style && (n.style.textDecorationLine || n.style.textDecoration);
        var fcolor = n.tagName === "FONT" ? n.getAttribute("color") : null;
        Array.prototype.slice.call(n.attributes).forEach(function (a) { n.removeAttribute(a.name); });
        if (color) n.style.color = color;
        if (weight) n.style.fontWeight = weight;
        if (deco && /underline/.test(deco)) n.style.textDecoration = "underline";
        if (fcolor) n.setAttribute("color", fcolor);
      });
    })(t.content);
    return t.innerHTML;
  };

  // ---------- 線 ----------
  function dashOf(kind, w) {
    if (kind === "dash") return (w * 5) + " " + (w * 3.5);
    if (kind === "dot") return "0.01 " + (w * 2.6);
    return null;
  }

  function fillLine(el, b) {
    var r = App.bbox(b);
    var x1 = b.x1 - r.x, y1 = b.y1 - r.y, x2 = b.x2 - r.x, y2 = b.y2 - r.y;
    var svg = s("svg", { viewBox: "0 0 " + r.w + " " + r.h, preserveAspectRatio: "none" });
    var len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    var head = Math.max(2.4, b.width * 5);
    var sx = x1, sy = y1, ex = x2, ey = y2;
    if (b.arrow === "end" || b.arrow === "both") { ex = x2 - ux * head * 0.8; ey = y2 - uy * head * 0.8; }
    if (b.arrow === "both") { sx = x1 + ux * head * 0.8; sy = y1 + uy * head * 0.8; }
    svg.appendChild(s("line", { class: "hit", x1: x1, y1: y1, x2: x2, y2: y2, stroke: "transparent", "stroke-width": 4 }));
    svg.appendChild(s("line", { x1: sx, y1: sy, x2: ex, y2: ey, stroke: b.color, "stroke-width": b.width,
      "stroke-dasharray": dashOf(b.dash, b.width), "stroke-linecap": b.dash === "dot" ? "round" : "butt" }));
    function tip(px, py, dx, dy) {
      var bx = px - dx * head, by = py - dy * head, wx = -dy * head * 0.38, wy = dx * head * 0.38;
      svg.appendChild(s("path", { d: "M" + px + " " + py + "L" + (bx + wx) + " " + (by + wy) + "L" + (bx - wx) + " " + (by - wy) + "z", fill: b.color }));
    }
    if (b.arrow === "end" || b.arrow === "both") tip(x2, y2, ux, uy);
    if (b.arrow === "both") tip(x1, y1, -ux, -uy);
    el.innerHTML = "";
    el.appendChild(svg);
  }

  // ---------- 図形 ----------
  function fillRect(el, b) {
    var w = b.w, hh = b.h, sw = b.width;
    var svg = s("svg", { viewBox: "0 0 " + w + " " + hh, preserveAspectRatio: "none" });
    var common = { fill: b.fill === "none" ? "none" : b.fill, stroke: b.color, "stroke-width": sw,
      "stroke-dasharray": dashOf(b.dash, sw), "stroke-linecap": b.dash === "dot" ? "round" : "butt" };
    var shape, hit;
    if (b.shape === "ellipse") {
      shape = s("ellipse", Object.assign({ cx: w / 2, cy: hh / 2, rx: Math.max(0.1, w / 2 - sw / 2), ry: Math.max(0.1, hh / 2 - sw / 2) }, common));
      hit = s("ellipse", { class: "hit", cx: w / 2, cy: hh / 2, rx: w / 2, ry: hh / 2, fill: "none", stroke: "transparent", "stroke-width": 4 });
    } else {
      var rad = b.shape === "round" ? Math.min(4, w / 4, hh / 4) : 0;
      shape = s("rect", Object.assign({ x: sw / 2, y: sw / 2, width: Math.max(0.1, w - sw), height: Math.max(0.1, hh - sw), rx: rad }, common));
      hit = s("rect", { class: "hit", x: 0, y: 0, width: w, height: hh, fill: "none", stroke: "transparent", "stroke-width": 4 });
    }
    if (b.fill !== "none") shape.setAttribute("class", "solid");
    svg.appendChild(shape);
    svg.appendChild(hit);
    el.innerHTML = "";
    el.appendChild(svg);
  }

  // ---------- 筆算 ----------
  function fillHissan(el, b) {
    el.innerHTML = "";
    var sol = Hissan.solve(b.expr, { zeroStep: b.zeroStep });
    if (!sol.ok) {
      b.w = 70; b.h = 16;
      el.appendChild(h("div", { class: "hissan-err no-print" }, sol.error));
      return;
    }
    var c = b.cell, showAns = b.mode === "answer";
    var rows = Math.max(sol.rows, sol.reserveRows) + (b.spare || 0);
    var W = sol.cols * c, H = rows * c;
    b.w = W; b.h = H;
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", style: "font-family:" + App.fontCss(b.font) });

    if (b.grid !== "none") {
      var col = App.GRID_COLORS.green, solid = "", dots = "", i;
      for (i = 0; i <= sol.cols; i++) solid += "M" + i * c + " 0v" + H;
      for (i = 0; i <= rows; i++) solid += "M0 " + i * c + "h" + W;
      if (b.grid === "hougan") {
        for (i = 0; i < sol.cols; i++) dots += "M" + (i * c + c / 2) + " 0v" + H;
        for (i = 0; i < rows; i++) dots += "M0 " + (i * c + c / 2) + "h" + W;
        svg.appendChild(s("path", { d: dots, fill: "none", stroke: col.dot, "stroke-width": 0.3, "stroke-dasharray": "0.6 1.5" }));
      }
      svg.appendChild(s("path", { d: solid, fill: "none", stroke: col.solid, "stroke-width": 0.32 }));
    }

    sol.cells.forEach(function (cell) {
      if (cell.role === "answer" && !showAns) return;
      var color = cell.role === "answer" ? b.ansColor : INK;
      var cx = cell.c * c + c / 2, cy = cell.r * c + c / 2;
      svg.appendChild(s("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": c * (cell.sign ? 0.62 : 0.74), fill: color }, cell.ch));
      if (cell.point) svg.appendChild(s("circle", { cx: cell.c * c + c, cy: cell.r * c + c * 0.8, r: c * 0.06, fill: color }));
      if (cell.strike) svg.appendChild(s("line", { x1: cx + c * 0.26, y1: cy - c * 0.34, x2: cx - c * 0.26, y2: cy + c * 0.34, stroke: color, "stroke-width": 0.35 }));
      if (cell.pointStrike) svg.appendChild(s("line", { x1: cell.c * c + c + c * 0.12, y1: cell.r * c + c * 0.66, x2: cell.c * c + c - c * 0.12, y2: cell.r * c + c * 0.94, stroke: color, "stroke-width": 0.35 }));
    });

    sol.rules.forEach(function (r) {
      if (r.role === "answer" && !showAns) return;
      var color = r.role === "answer" ? b.ansColor : INK;
      svg.appendChild(s("line", { x1: r.c0 * c - (r.vinculum ? 0 : c * 0.08), y1: r.r * c, x2: (r.c1 + 1) * c + c * 0.08, y2: r.r * c,
        stroke: color, "stroke-width": 0.5, "stroke-linecap": "round" }));
    });

    if (sol.bracket) {
      var bx = sol.bracket.c * c, top = sol.bracket.r * c, bot = top + c;
      svg.appendChild(s("path", { d: "M" + bx + " " + top + "C" + (bx + c * 0.26) + " " + (top + c * 0.3) + " " + (bx + c * 0.26) + " " + (bot - c * 0.34) + " " + (bx - c * 0.1) + " " + (bot - c * 0.02),
        fill: "none", stroke: INK, "stroke-width": 0.5, "stroke-linecap": "round" }));
    }
    el.appendChild(svg);
  }

  // ---------- 式 ----------
  function fillShiki(el, b) {
    el.innerHTML = "";
    var box = h("div", { class: "sk", style: "font-family:" + App.fontCss(b.font) + ";font-size:" + b.size + "pt;color:" + b.color });
    var tokens = Shiki.parse(b.src);
    if (!tokens.length) box.appendChild(h("span", { class: "sk-empty no-print" }, "式を入れてください"));
    tokens.forEach(function (t) {
      if (t.t === "num") box.appendChild(h("span", { class: "sk-num" }, t.v));
      else if (t.t === "op") box.appendChild(h("span", { class: "sk-op" }, t.v));
      else if (t.t === "paren") box.appendChild(h("span", { class: "sk-paren" }, t.v));
      else if (t.t === "text") box.appendChild(h("span", { class: "sk-text" }, t.v));
      else if (t.t === "box") box.appendChild(h("span", { class: "sk-box", style: "width:" + (1.25 * t.n) + "em" }));
      else if (t.t === "frac" || t.t === "mixed") {
        if (t.t === "mixed") box.appendChild(h("span", { class: "sk-num sk-whole" }, t.whole));
        box.appendChild(h("span", { class: "sk-frac" }, fracPart(t.num), h("span", { class: "sk-bar" }), fracPart(t.den)));
      }
    });
    el.appendChild(box);
  }
  function fracPart(v) {
    if (/^□+$/.test(v)) return h("span", { class: "sk-part" }, h("span", { class: "sk-box small", style: "width:" + (1.1 * v.length) + "em" }));
    return h("span", { class: "sk-part" }, v);
  }

  // ---------- 画像 ----------
  function fillImage(el, b) {
    el.innerHTML = "";
    if (b.src) el.appendChild(h("img", { src: b.src, alt: "", draggable: "false" }));
  }

  // ---------- 選んでいる部品のわく ----------
  App.drawSelection = function () {
    document.querySelectorAll(".selbox").forEach(function (n) { n.remove(); });
    var f = App.selId ? App.find(App.selId) : null;
    if (!f) return;
    var b = f.block, page = App.pageEl(f.page);
    if (!page) return;
    var r = App.bbox(b);
    var box = h("div", { class: "selbox no-print " + b.type + (App.edit && App.edit.id === b.id ? " editing" : ""), "data-id": b.id });

    if (b.type === "line") {
      box.style.cssText = "left:0;top:0;width:0;height:0;border:0";
      [["p1", b.x1, b.y1], ["p2", b.x2, b.y2]].forEach(function (p) {
        box.appendChild(h("div", { class: "h round", "data-h": p[0], style: "left:" + p[1] + "mm;top:" + p[2] + "mm" }));
      });
      var gx = Math.min(b.x1, b.x2), gy = Math.min(b.y1, b.y2);
      box.appendChild(h("div", { class: "grip", style: "left:" + gx + "mm;top:calc(" + gy + "mm - 26px)" }, gripIcon(), App.TYPE_NAMES[b.type]));
    } else {
      box.style.cssText = "left:" + r.x + "mm;top:" + r.y + "mm;width:" + r.w + "mm;height:" + r.h + "mm";
      ["n", "s", "e", "w"].forEach(function (k) { box.appendChild(h("div", { class: "edge " + k })); });
      box.appendChild(h("div", { class: "grip" }, gripIcon(), App.TYPE_NAMES[b.type]));
      var hs = [];
      if (b.type === "masu" || b.type === "text" || b.type === "rect") hs = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
      else if (b.type === "image") hs = ["nw", "ne", "se", "sw"];
      hs.forEach(function (k) { box.appendChild(h("div", { class: "h " + k, "data-h": k })); });
    }
    page.appendChild(box);
  };
  function gripIcon() {
    var svg = s("svg", { viewBox: "0 0 10 10", width: 10, height: 10, "aria-hidden": "true" });
    [[2.5, 2], [7.5, 2], [2.5, 5], [7.5, 5], [2.5, 8], [7.5, 8]].forEach(function (p) {
      svg.appendChild(s("circle", { cx: p[0], cy: p[1], r: 1, fill: "currentColor" }));
    });
    return svg;
  }
})();
