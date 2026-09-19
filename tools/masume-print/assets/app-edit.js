/* app-edit.js — 選ぶ、動かす、大きさを変える、文字を打つ。 */
(function () {
  "use strict";
  var App = window.App, h = App.h, clamp = App.clamp;
  var ime = null;
  var clipboard = null;
  var addCount = 0;

  // ---------- 選ぶ ----------
  App.select = function (id) {
    if (App.selId === id) return;
    App.selId = id;
    App.drawSelection();
    App.renderPanel();
  };

  var TOOL_TIPS = { line: "線", arrow: "矢印", rect: "四角形", ellipse: "楕円" };
  App.setTool = function (t) {
    if (t && t !== App.tool && App.toast) App.toast("紙の上をドラッグして、" + (TOOL_TIPS[t] || "図形") + "を描きます。やめるときは Esc キーか、同じボタンをもう一度押します。", 5000);
    App.tool = t;
    document.body.classList.toggle("drawing", !!t);
    document.querySelectorAll(".tools button[data-tool]").forEach(function (b) {
      b.classList.toggle("on", b.dataset.tool === t);
    });
  };

  // ---------- 文字を打つ状態に入る・出る ----------
  App.startEdit = function (b, ev) {
    App.stopEditing();
    App.selId = b.id;
    if (b.type === "masu") {
      var idx = ev ? masuIndexFromEvent(b, ev) : b.text.length;
      App.edit = { id: b.id, type: "masu", anchor: idx, focus: idx, comp: null, composing: false };
      ime.value = b.text;
      syncIme();
      ime.focus({ preventScroll: true });
      App.drawSelection();
      drawMasuCaret();
    } else if (b.type === "text") {
      App.edit = { id: b.id, type: "text" };
      var tx = App.blockEl(b.id).querySelector(".tx");
      tx.contentEditable = "true";
      tx.focus({ preventScroll: true });
      var sel = window.getSelection(), range = null;
      if (ev && document.caretRangeFromPoint) range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
      if (!range || !tx.contains(range.startContainer)) {
        range = document.createRange();
        range.selectNodeContents(tx);
        range.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(range);
      App.drawSelection();
    }
    App.renderPanel();
  };

  App.stopEditing = function () {
    var e = App.edit;
    if (!e) return;
    App.edit = null;
    var f = App.find(e.id);
    if (e.type === "text") {
      var el = App.blockEl(e.id), tx = el && el.querySelector(".tx");
      if (tx) {
        tx.contentEditable = "false";
        if (f) f.block.html = App.cleanHtml(tx.innerHTML);
        var sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        tx.blur();
      }
      App.commit();
    } else if (e.type === "masu") {
      ime.blur();
      var bel = App.blockEl(e.id), ov = bel && bel.querySelector(".ov");
      if (ov) ov.innerHTML = "";
    }
    App.drawSelection();
  };

  // ---------- マス目：クリックした場所から字の位置を求める ----------
  function masuIndexFromEvent(b, ev) {
    var el = App.blockEl(b.id), r = el.getBoundingClientRect(), g = App.masuGeom(b);
    var k = r.width / g.W;
    var x = (ev.clientX - r.left) / k, y = (ev.clientY - r.top) / k;
    var c = b.cell, gp = b.gap || 0, L, P, frac;
    if (b.dir === "v") { L = Math.floor((g.W - x) / (c + gp)); P = Math.floor(y / c); frac = y / c - P; }
    else { L = Math.floor(y / (c + gp)); P = Math.floor(x / c); frac = x / c - P; }
    L = clamp(L, 0, b.lines - 1);
    P = clamp(P, 0, b.perLine - 1);
    var res = App.layouts[b.id], len = b.text.length;
    var idx = Masu.indexAt(res, L, P, len);
    var cell = res.lines[L] && res.lines[L].cells[P];
    if (cell && cell.parts.length && frac > 0.5) {
      var last = cell.hang.length ? cell.hang[cell.hang.length - 1] : cell.parts[cell.parts.length - 1];
      idx = last.i + last.len;
    }
    return idx;
  }

  function syncIme() {
    var e = App.edit;
    if (!e || e.type !== "masu") return;
    var a = Math.min(e.anchor, e.focus), z = Math.max(e.anchor, e.focus);
    try { ime.setSelectionRange(a, z, e.focus < e.anchor ? "backward" : "forward"); } catch (err) { /* 何もしない */ }
  }
  function readImeSel() {
    var e = App.edit;
    if (!e || e.type !== "masu") return;
    var a = ime.selectionStart, z = ime.selectionEnd;
    if (ime.selectionDirection === "backward") { e.anchor = z; e.focus = a; }
    else { e.anchor = a; e.focus = z; }
    drawMasuCaret();
  }

  /** カーソルと、選んでいるマスの色を描く。見えない入力らんもカーソルの所へ動かす。 */
  function drawMasuCaret() {
    var e = App.edit;
    if (!e || e.type !== "masu") return;
    var f = App.find(e.id);
    if (!f) return;
    var b = f.block, el = App.blockEl(b.id), ov = el && el.querySelector(".ov");
    if (!ov) return;
    ov.innerHTML = "";
    var res = App.layouts[b.id], g = App.masuGeom(b), c = b.cell;
    var a = Math.min(e.anchor, e.focus), z = Math.max(e.anchor, e.focus);

    function paint(from, to, cls) {
      res.lines.forEach(function (ln, L) {
        if (L >= b.lines) return;
        ln.cells.forEach(function (cell, P) {
          if (!cell) return;
          var parts = cell.parts.concat(cell.hang), hit = false;
          for (var i = 0; i < parts.length; i++) if (parts[i].i >= from && parts[i].i < to) { hit = true; break; }
          if (!hit) return;
          var xy = g.xy(L, P);
          ov.appendChild(h("div", { class: cls, style: "left:" + xy[0] + "mm;top:" + xy[1] + "mm;width:" + c + "mm;height:" + c + "mm" }));
        });
      });
    }
    if (z > a) paint(a, z, "selcell");
    if (e.comp) paint(e.comp.s, e.comp.e, "compcell");

    var cp = res.caret[Math.min(e.focus, res.caret.length - 1)] || { line: 0, pos: 0 };
    var atEnd = cp.pos >= b.perLine;
    var xy = g.xy(cp.line, atEnd ? b.perLine - 1 : cp.pos), st;
    if (b.dir === "v") st = "left:" + (xy[0] + c * 0.08) + "mm;top:" + (xy[1] + (atEnd ? c : 0)) + "mm;width:" + c * 0.84 + "mm;height:0.6mm;margin-top:-0.3mm";
    else st = "left:" + (xy[0] + (atEnd ? c : 0)) + "mm;top:" + (xy[1] + c * 0.08) + "mm;width:0.6mm;height:" + c * 0.84 + "mm;margin-left:-0.3mm";
    ov.appendChild(h("div", { class: "caret" + (document.activeElement === ime ? "" : " idle"), style: st }));

    // 変換の候補がカーソルの近くに出るように、見えない入力らんを動かす
    var r = el.getBoundingClientRect(), k = r.width / g.W;
    ime.style.left = clamp(r.left + (xy[0] + c / 2) * k, 0, window.innerWidth - 4) + "px";
    ime.style.top = clamp(r.top + (xy[1] + c) * k, 0, window.innerHeight - 24) + "px";
  }
  App.drawMasuCaret = drawMasuCaret;
  /** 打っているマス目の、選ぶ範囲を決める（テストや見本づくりから使う）。 */
  App.setMasuSelection = function (anchor, focus) {
    var e = App.edit;
    if (!e || e.type !== "masu") return;
    e.anchor = anchor; e.focus = focus;
    syncIme();
    drawMasuCaret();
  };

  function onImeInput() {
    var e = App.edit;
    if (!e || e.type !== "masu") return;
    var f = App.find(e.id);
    if (!f) return;
    var b = f.block, neu = ime.value.replace(/\r/g, "");
    if (neu !== b.text) {
      b.styles = Masu.adjustStyles(b.styles, b.text, neu);
      b.text = neu;
    }
    e.anchor = e.focus = ime.selectionStart;
    App.refreshBlock(b);
    App.drawSelection();
    drawMasuCaret();
    if (!e.composing) App.commit("type:" + b.id);
  }

  function stepIndex(text, i, d) {
    if (d > 0) {
      if (i >= text.length) return text.length;
      return i + (text.codePointAt(i) > 0xffff ? 2 : 1);
    }
    if (i <= 0) return 0;
    var lo = text.charCodeAt(i - 1);
    return i - (lo >= 0xdc00 && lo <= 0xdfff && i >= 2 ? 2 : 1);
  }

  function moveCaret(b, kind, shift) {
    var e = App.edit, res = App.layouts[b.id], len = b.text.length, fcs = e.focus;
    if (!shift && e.anchor !== e.focus && (kind === "next" || kind === "prev")) {
      fcs = kind === "next" ? Math.max(e.anchor, e.focus) : Math.min(e.anchor, e.focus);
    } else if (kind === "next") fcs = stepIndex(b.text, fcs, 1);
    else if (kind === "prev") fcs = stepIndex(b.text, fcs, -1);
    else {
      var cp = res.caret[fcs], L = cp.line + (kind === "lineNext" ? 1 : -1);
      if (L < 0) fcs = 0;
      else if (L >= res.lines.length) fcs = len;
      else fcs = Masu.indexAt(res, L, Math.min(cp.pos, b.perLine - 1), len);
    }
    e.focus = fcs;
    if (!shift) e.anchor = fcs;
    syncIme();
    drawMasuCaret();
  }

  function masuPointerDown(ev, b) {
    var e = App.edit, idx = masuIndexFromEvent(b, ev);
    if (ev.shiftKey) e.focus = idx; else e.anchor = e.focus = idx;
    syncIme();
    ime.focus({ preventScroll: true });
    drawMasuCaret();
    function mv(m) { e.focus = masuIndexFromEvent(b, m); syncIme(); drawMasuCaret(); }
    function up() {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      ime.focus({ preventScroll: true });
      drawMasuCaret();
    }
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }

  /** マス目の選んだ字に書式をつける。 */
  App.applyMasuStyle = function (patch) {
    var e = App.edit, b = App.selected();
    if (!b || b.type !== "masu") return;
    if (!e || e.type !== "masu" || e.anchor === e.focus) {
      App.toast("マス目の中をドラッグして、文字を選択してから押してください。");
      return;
    }
    var a = Math.min(e.anchor, e.focus), z = Math.max(e.anchor, e.focus);
    b.styles = Masu.applyStyle(b.styles, b.text.length, a, z, patch);
    App.refreshBlock(b);
    drawMasuCaret();
    App.commit();
    ime.focus({ preventScroll: true });
  };
  App.clearMasuStyle = function () {
    var e = App.edit, b = App.selected();
    if (!b || b.type !== "masu") return;
    if (!e || e.type !== "masu" || e.anchor === e.focus) { App.toast("マス目の中をドラッグして、文字を選択してから押してください。"); return; }
    var a = Math.min(e.anchor, e.focus), z = Math.max(e.anchor, e.focus);
    for (var i = a; i < z; i++) b.styles[i] = null;
    App.refreshBlock(b);
    drawMasuCaret();
    App.commit();
    ime.focus({ preventScroll: true });
  };

  /** 文字の部品で、字を選んでいればそこだけに書式をつける。つけたら true。 */
  App.applyTextCommand = function (cmd, value) {
    var e = App.edit, sel = window.getSelection();
    if (!e || e.type !== "text" || !sel || !sel.rangeCount || sel.isCollapsed) return false;
    var tx = App.blockEl(e.id).querySelector(".tx");
    if (!tx.contains(sel.anchorNode)) return false;
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(cmd, false, value);
    var f = App.find(e.id);
    f.block.html = App.cleanHtml(tx.innerHTML);
    App.commit();
    return true;
  };

  // ---------- 動かす ----------
  function startMove(ev, b, fromGrip) {
    var f = App.find(b.id), page = App.pageEl(f.page), k = App.pxPerMm(page);
    var sx = ev.clientX, sy = ev.clientY, o = JSON.parse(JSON.stringify(b)), moved = false;
    function mv(m) {
      if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
      moved = true;
      var dx = (m.clientX - sx) / k, dy = (m.clientY - sy) / k;
      if (b.type === "line") {
        var nx = m.altKey ? o.x1 + dx : App.snap(o.x1 + dx), ny = m.altKey ? o.y1 + dy : App.snap(o.y1 + dy);
        b.x2 = o.x2 + (nx - o.x1); b.y2 = o.y2 + (ny - o.y1); b.x1 = nx; b.y1 = ny;
      } else {
        b.x = m.altKey ? o.x + dx : App.snap(o.x + dx);
        b.y = m.altKey ? o.y + dy : App.snap(o.y + dy);
      }
      App.placeBlock(App.blockEl(b.id), b);
      App.drawSelection();
    }
    function up(u) {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      if (moved) { App.commit(); App.renderPanel(); }
      else if (!fromGrip && (b.type === "masu" || b.type === "text")) App.startEdit(b, u);
    }
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }

  // ---------- 大きさを変える ----------
  function startResize(ev, code) {
    var b = App.selected();
    if (!b) return;
    var f = App.find(b.id), page = App.pageEl(f.page), k = App.pxPerMm(page);
    var sx = ev.clientX, sy = ev.clientY, o = JSON.parse(JSON.stringify(b)), changed = false;
    function mv(m) {
      changed = true;
      if (b.type === "line") {
        var pr = page.getBoundingClientRect();
        var px = App.snap((m.clientX - pr.left) / k), py = App.snap((m.clientY - pr.top) / k);
        var ox = code === "p1" ? o.x2 : o.x1, oy = code === "p1" ? o.y2 : o.y1;
        if (m.shiftKey) {
          var ang = Math.round(Math.atan2(py - oy, px - ox) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(px - ox, py - oy);
          px = Math.round((ox + Math.cos(ang) * len) * 100) / 100;
          py = Math.round((oy + Math.sin(ang) * len) * 100) / 100;
        }
        if (code === "p1") { b.x1 = px; b.y1 = py; } else { b.x2 = px; b.y2 = py; }
        App.refreshBlock(b);
        App.drawSelection();
        return;
      }
      var dx = (m.clientX - sx) / k, dy = (m.clientY - sy) / k;
      var left = o.x, right = o.x + o.w, top = o.y, bottom = o.y + o.h;
      if (code.indexOf("w") >= 0) left = o.x + dx;
      if (code.indexOf("e") >= 0) right = o.x + o.w + dx;
      if (code.indexOf("n") >= 0) top = o.y + dy;
      if (code.indexOf("s") >= 0) bottom = o.y + o.h + dy;

      if (b.type === "masu") {
        var c = o.cell, gp = o.gap || 0, w = Math.max(c, right - left), hh = Math.max(c, bottom - top), nLines, nPer;
        if (o.dir === "v") { nLines = Math.round((w + gp) / (c + gp)); nPer = Math.round(hh / c); }
        else { nPer = Math.round(w / c); nLines = Math.round((hh + gp) / (c + gp)); }
        b.perLine = clamp(nPer, 1, 80);
        b.lines = clamp(nLines, 1, 80);
        var g = App.masuGeom(b);
        b.x = code.indexOf("w") >= 0 ? o.x + o.w - g.W : o.x;
        b.y = code.indexOf("n") >= 0 ? o.y + o.h - g.H : o.y;
      } else if (b.type === "image") {
        var ratio = o.w / o.h, nw = Math.max(8, right - left);
        var nh = nw / ratio;
        b.w = nw; b.h = nh;
        b.x = code.indexOf("w") >= 0 ? o.x + o.w - nw : o.x;
        b.y = code.indexOf("n") >= 0 ? o.y + o.h - nh : o.y;
      } else {
        if (!m.altKey) { left = App.snap(left); right = App.snap(right); top = App.snap(top); bottom = App.snap(bottom); }
        if (right - left < 4) { if (code.indexOf("w") >= 0) left = right - 4; else right = left + 4; }
        if (bottom - top < 4) { if (code.indexOf("n") >= 0) top = bottom - 4; else bottom = top + 4; }
        b.x = left; b.y = top; b.w = right - left; b.h = bottom - top;
      }
      App.refreshBlock(b);
      App.drawSelection();
      if (App.edit && App.edit.id === b.id) drawMasuCaret();
    }
    function up() {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      if (changed) { App.commit(); App.renderPanel(); }
    }
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }

  // ---------- ドラッグで描く（線・矢印・図形） ----------
  function startDraw(ev, page) {
    var pi = +page.parentNode.dataset.page, k = App.pxPerMm(page), pr = page.getBoundingClientRect();
    function pt(m) { return [App.snap((m.clientX - pr.left) / k), App.snap((m.clientY - pr.top) / k)]; }
    var p0 = pt(ev), kind = App.tool, b;
    App.stopEditing();
    if (kind === "line" || kind === "arrow") b = App.make.line({ x1: p0[0], y1: p0[1], x2: p0[0], y2: p0[1], arrow: kind === "arrow" ? "end" : "none" });
    else b = App.make.rect({ x: p0[0], y: p0[1], w: 0.1, h: 0.1, shape: kind === "ellipse" ? "ellipse" : "rect" });
    App.doc.pages[pi].blocks.push(b);
    page.appendChild(App.buildBlock(b));
    function mv(m) {
      var p = pt(m);
      if (b.type === "line") {
        if (m.shiftKey) {
          var ang = Math.round(Math.atan2(p[1] - p0[1], p[0] - p0[0]) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(p[0] - p0[0], p[1] - p0[1]);
          p = [Math.round((p0[0] + Math.cos(ang) * len) * 100) / 100, Math.round((p0[1] + Math.sin(ang) * len) * 100) / 100];
        }
        b.x2 = p[0]; b.y2 = p[1];
      } else {
        b.x = Math.min(p0[0], p[0]); b.y = Math.min(p0[1], p[1]);
        b.w = Math.max(0.1, Math.abs(p[0] - p0[0])); b.h = Math.max(0.1, Math.abs(p[1] - p0[1]));
      }
      App.refreshBlock(b);
    }
    function up() {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      if (b.type === "line" && Math.hypot(b.x2 - b.x1, b.y2 - b.y1) < 2) { b.x2 = b.x1 + 50; b.y2 = b.y1; }
      if (b.type === "rect" && (b.w < 2 || b.h < 2)) { b.w = 60; b.h = 30; }
      App.refreshBlock(b);
      App.setTool(null);
      App.commit();
      App.select(b.id);
    }
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }

  // ---------- 部品の出し入れ ----------
  App.currentPage = function () {
    var sr = App.$("#stage").getBoundingClientRect(), best = 0, bestVis = -1;
    document.querySelectorAll(".page-wrap").forEach(function (w, i) {
      var r = w.getBoundingClientRect(), vis = Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top);
      if (vis > bestVis) { bestVis = vis; best = i; }
    });
    return best;
  };

  App.addBlock = function (type, opts) {
    App.stopEditing();
    App.setTool(null);
    var at = opts && opts.at;
    if (opts && "at" in opts) { opts = Object.assign({}, opts); delete opts.at; }
    var pi = at && at.page >= 0 && App.doc.pages[at.page] ? at.page : App.currentPage(), page = App.pageEl(pi), k = App.pxPerMm(page);
    var pr = page.getBoundingClientRect(), sr = App.$("#stage").getBoundingClientRect(), size = App.pageSize();
    var m = App.doc.margin || 10, others = App.doc.pages[pi].blocks.slice();
    var b = App.make[type](Object.assign({}, opts || {}));
    App.doc.pages[pi].blocks.push(b);
    page.appendChild(App.buildBlock(b));
    App.measureAuto();
    // 置き場所：いまある部品のいちばん下の、すぐ下。入らなければ、見えている所の左上にずらして置く
    var bw = b.w || 60, bh = b.h || 20, bottom = 0;
    others.forEach(function (o) { var r = App.bbox(o); bottom = Math.max(bottom, r.y + r.h); });
    var rightSide = b.type === "masu" && b.dir === "v";
    if (!others.length) { b.x = rightSide ? size[0] - m - bw : m; b.y = m; }
    else if (bottom + 6 + bh <= size[1] - m) { b.x = rightSide ? size[0] - m - bw : m; b.y = App.snap(bottom + 6); }
    else {
      var off = (addCount++ % 5) * 6;
      b.x = m + 5 + off;
      b.y = App.snap(Math.min(Math.max(0, (sr.top - pr.top) / k) + 15 + off, size[1] - 40));
    }
    // いま見えている範囲（mm）。決めた場所が見えていないか、ほかと重なるときは、見えている所で空いている場所を探す
    var visTop = Math.max(0, (sr.top - pr.top) / k), visBot = Math.min(size[1], (sr.bottom - pr.top) / k);
    function hits(x, y) {
      return others.some(function (o) { var r = App.bbox(o); return x < r.x + r.w && x + bw > r.x && y < r.y + r.h && y + bh > r.y; });
    }
    var unseen = b.y + Math.min(bh, 12) > visBot || b.y < visTop - 1;
    if (!at && others.length && (unseen || hits(b.x, b.y))) {
      var found = null, x0 = rightSide ? size[0] - m - bw : m;
      for (var yy = Math.max(m, Math.ceil(visTop) + 4); yy + bh <= Math.min(size[1] - m, visBot) && !found; yy += 4) {
        for (var xx = x0; xx >= m && xx + bw <= size[0] - m; xx += rightSide ? -8 : 8) {
          if (!hits(xx, yy)) { found = [xx, yy]; break; }
        }
      }
      if (found) { b.x = found[0]; b.y = App.snap(found[1]); }
      else if (unseen) { b.x = m + 5 + off; b.y = App.snap(Math.min(visTop + 15 + off, size[1] - 40)); }
    }
    // at があれば、その点がまん中になるように置く（画像を紙の上に落としたとき）
    if (at) {
      b.x = Math.min(Math.max(0, at.x - bw / 2), Math.max(0, size[0] - bw));
      b.y = App.snap(Math.min(Math.max(0, at.y - bh / 2), Math.max(0, size[1] - bh)));
    }
    if (b.x + bw > size[0]) b.x = Math.max(0, size[0] - bw - m);
    b.x = App.snap(b.x);
    App.placeBlock(App.blockEl(b.id), b);
    App.commit();
    App.selId = null;
    App.select(b.id);
    if (type === "masu" || type === "text") App.startEdit(b, null);
    return b;
  };

  App.removeBlock = function (id) {
    var f = App.find(id);
    if (!f) return;
    App.stopEditing();
    App.doc.pages[f.page].blocks.splice(f.index, 1);
    var el = App.blockEl(id);
    if (el) el.remove();
    App.selId = null;
    App.drawSelection();
    App.renderPanel();
    App.commit();
  };

  App.duplicate = function (id) {
    var f = App.find(id);
    if (!f) return;
    App.stopEditing();
    pasteBlock(JSON.stringify(f.block), f.page);
  };
  function pasteBlock(json, pi) {
    var b = JSON.parse(json);
    b.id = App.uid();
    if (b.type === "line") { b.x1 += 5; b.x2 += 5; b.y1 += 5; b.y2 += 5; } else { b.x += 5; b.y += 5; }
    App.doc.pages[pi].blocks.push(b);
    App.pageEl(pi).appendChild(App.buildBlock(b));
    App.measureAuto();
    App.commit();
    App.selId = null;
    App.select(b.id);
  }

  App.reorder = function (id, dir) {
    var f = App.find(id);
    if (!f) return;
    var bs = App.doc.pages[f.page].blocks;
    bs.splice(f.index, 1);
    if (dir === "front") bs.push(f.block); else bs.unshift(f.block);
    var page = App.pageEl(f.page), el = App.blockEl(id);
    if (dir === "front") page.appendChild(el);
    else page.insertBefore(el, page.querySelector(".blk"));
    App.drawSelection();
    App.commit();
  };

  // ---------- ページ ----------
  /** ページを足す。from（ページの番号）があれば、そのページと同じものを、すぐ下に足す。なければ白紙をいちばん下に足す。 */
  App.addPage = function (from) {
    App.stopEditing();
    var at = App.doc.pages.length;
    if (typeof from === "number" && App.doc.pages[from]) {
      var copy = JSON.parse(JSON.stringify(App.doc.pages[from]));
      copy.blocks.forEach(function (b) { b.id = App.uid(); });
      at = from + 1;
      App.doc.pages.splice(at, 0, copy);
    } else App.doc.pages.push({ blocks: [] });
    App.selId = null;
    App.commit();
    App.renderAll();
    App.renderPanel();
    var w = document.querySelectorAll(".page-wrap");
    if (w[at]) w[at].scrollIntoView({ behavior: "smooth", block: "start" });
  };
  App.removePage = function (pi) {
    if (App.doc.pages.length <= 1) return;
    App.stopEditing();
    App.doc.pages.splice(pi, 1);
    App.selId = null;
    App.commit();
    App.renderAll();
    App.renderPanel();
    App.toast("ページを消しました。「元に戻す」で戻せます。");
  };

  // ---------- 拡大・縮小 ----------
  App.setScale = function (v) {
    App.scale = clamp(Math.round(v * 100) / 100, 0.25, 3);
    App.applyScale();
    drawMasuCaret();
  };
  App.fitWidth = function (cap) {
    var avail = App.$("#stage").clientWidth - 64, w = App.pageSize()[0] * App.MM;
    App.setScale(Math.min(cap || 1.6, avail / w));
  };

  // ---------- お知らせ ----------
  var toastTimer = null;
  App.toast = function (msg, ms) {
    var t = App.$("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, ms || 3600);
  };

  // ---------- 元に戻したあとの描きなおし ----------
  App.onRestore = function () {
    var e = App.edit;
    App.edit = null;
    if (e && e.type === "masu") ime.blur();
    if (App.selId && !App.find(App.selId)) App.selId = null;
    App.renderAll();
    App.syncHeader();
    var f = e && e.type === "masu" ? App.find(e.id) : null;
    if (f) App.startEdit(f.block, null);
    else App.renderPanel();
  };

  // ---------- 画面のイベント ----------
  App.initEditing = function () {
    ime = App.$("#ime");
    var pages = App.$("#pages"), stage = App.$("#stage");

    ime.addEventListener("input", onImeInput);
    ime.addEventListener("compositionstart", function () {
      var e = App.edit;
      if (e) { e.composing = true; e.compStart = ime.selectionStart; }
    });
    ime.addEventListener("compositionupdate", function (ev) {
      var e = App.edit;
      if (e) e.comp = { s: e.compStart, e: e.compStart + (ev.data || "").length };
    });
    ime.addEventListener("compositionend", function () {
      var e = App.edit;
      if (!e) return;
      e.composing = false;
      e.comp = null;
      setTimeout(onImeInput, 0);
    });
    ime.addEventListener("keydown", function (ev) {
      var e = App.edit;
      if (!e || e.type !== "masu" || ev.isComposing || ev.keyCode === 229) return;
      var f = App.find(e.id);
      if (!f) return;
      var v = f.block.dir === "v", kind = null;
      if (ev.key === "ArrowDown") kind = v ? "next" : "lineNext";
      else if (ev.key === "ArrowUp") kind = v ? "prev" : "linePrev";
      else if (ev.key === "ArrowLeft") kind = v ? "lineNext" : "prev";
      else if (ev.key === "ArrowRight") kind = v ? "linePrev" : "next";
      else if (ev.key === "Escape") { ev.preventDefault(); App.stopEditing(); App.renderPanel(); return; }
      else if (ev.key === "Tab") { ev.preventDefault(); return; }
      if (kind) { ev.preventDefault(); moveCaret(f.block, kind, ev.shiftKey); }
    });
    ime.addEventListener("keyup", function (ev) {
      if (/^Arrow/.test(ev.key) || ev.isComposing) return;
      readImeSel();
    });
    ime.addEventListener("select", readImeSel);
    ime.addEventListener("focus", drawMasuCaret);
    ime.addEventListener("blur", drawMasuCaret);

    // 文字の部品（その場で打つ）
    pages.addEventListener("input", function (ev) {
      var tx = ev.target.closest && ev.target.closest(".tx");
      if (!tx || !App.edit || App.edit.type !== "text") return;
      var f = App.find(App.edit.id);
      if (!f) return;
      f.block.html = App.cleanHtml(tx.innerHTML);
      if (App.fitTextBlock(f.block)) App.drawSelection();
      App.commit("type:" + f.block.id);
    });
    pages.addEventListener("paste", function (ev) {
      var tx = ev.target.closest && ev.target.closest(".tx");
      if (!tx) return;
      ev.preventDefault();
      var t = (ev.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, t);
    });

    // フォーカスを持っていかれないようにする（マス目に打っている最中・つまみ・ハンドル）
    pages.addEventListener("mousedown", function (ev) {
      var blk = ev.target.closest(".blk");
      var editingText = App.edit && App.edit.type === "text" && blk && blk.dataset.id === App.edit.id;
      if (!editingText) ev.preventDefault();
    });

    pages.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      var page = ev.target.closest(".page");
      if (!page) return;
      // 右の設定らんに入っていたフォーカスを外す（Deleteキーなどを紙の側で受けるため）
      var ae = document.activeElement;
      if (ae && ae !== ime && ae !== document.body && ae.closest && ae.closest("#panel, .bar")) ae.blur();
      // 大きさを変えるハンドル。横書きのマス目にも "h" というクラスがつくので、data-h のあるものだけを見る
      var hEl = ev.target.closest(".h[data-h]");
      if (hEl) return startResize(ev, hEl.dataset.h);
      if (ev.target.closest(".grip") || ev.target.closest(".edge")) {
        var sb = App.selected();
        if (sb) { App.stopEditing(); startMove(ev, sb, true); }
        return;
      }
      if (App.tool) return startDraw(ev, page);
      var bEl = ev.target.closest(".blk");
      if (!bEl) { App.stopEditing(); App.select(null); return; }
      var f = App.find(bEl.dataset.id);
      if (!f) return;
      var b = f.block;
      if (App.edit && App.edit.id === b.id) {
        if (b.type === "masu") masuPointerDown(ev, b);
        return;
      }
      App.stopEditing();
      App.select(b.id);
      startMove(ev, b, false);
    });

    stage.addEventListener("pointerdown", function (ev) {
      if (ev.target === stage || ev.target.id === "pages" || ev.target.classList.contains("page-wrap")) {
        App.stopEditing();
        App.select(null);
      }
    });

    pages.addEventListener("dblclick", function (ev) {
      var bEl = ev.target.closest(".blk");
      if (!bEl) return;
      var f = App.find(bEl.dataset.id);
      if (f && (f.block.type === "hissan" || f.block.type === "shiki")) {
        var inp = App.$("#panel input[data-main]");
        if (inp) { inp.focus(); inp.select(); }
      }
    });

    document.addEventListener("keydown", function (ev) {
      var t = ev.target, mod = ev.metaKey || ev.ctrlKey, key = ev.key;
      var inIme = t === ime;
      var inField = !inIme && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (mod && (key === "z" || key === "Z")) {
        if (inField) return;
        ev.preventDefault();
        if (ev.shiftKey) App.redo(); else App.undo();
        return;
      }
      if (mod && (key === "y" || key === "Y")) { if (inField) return; ev.preventDefault(); App.redo(); return; }
      if (mod && (key === "s" || key === "S")) { ev.preventDefault(); App.saveFile(); return; }
      if (t.isContentEditable && key === "Escape") { App.stopEditing(); App.renderPanel(); return; }
      if (inIme || inField) return;

      if (key === "Escape") { if (App.tool) App.setTool(null); else App.select(null); return; }
      if (mod && (key === "v" || key === "V") && clipboard) { ev.preventDefault(); pasteBlock(clipboard, App.currentPage()); return; }
      var b = App.selected();
      if (!b) return;
      if (key === "Delete" || key === "Backspace") { ev.preventDefault(); App.removeBlock(b.id); }
      else if (key === "Enter" && (b.type === "masu" || b.type === "text")) { ev.preventDefault(); App.startEdit(b, null); }
      else if (mod && (key === "d" || key === "D")) { ev.preventDefault(); App.duplicate(b.id); }
      else if (mod && (key === "c" || key === "C")) { clipboard = JSON.stringify(b); App.toast("コピーしました。"); }
      else if (/^Arrow/.test(key)) {
        ev.preventDefault();
        var st = (App.doc.snap || 1) * (ev.shiftKey ? 5 : 1);
        var dx = key === "ArrowLeft" ? -st : key === "ArrowRight" ? st : 0, dy = key === "ArrowUp" ? -st : key === "ArrowDown" ? st : 0;
        if (b.type === "line") { b.x1 += dx; b.x2 += dx; b.y1 += dy; b.y2 += dy; } else { b.x += dx; b.y += dy; }
        App.placeBlock(App.blockEl(b.id), b);
        App.drawSelection();
        App.commit("nudge:" + b.id);
      }
    });

    window.addEventListener("resize", function () { drawMasuCaret(); });
    stage.addEventListener("scroll", function () { drawMasuCaret(); });
  };
})();
