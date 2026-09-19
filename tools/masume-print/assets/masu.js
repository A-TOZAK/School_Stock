/* masu.js — マス目への文字の流し込み（原稿用紙のきまり）
 * 画面には触らない。ブラウザとNodeのテストの両方から使う。
 *
 * layout(text, {perLine, dir, rules}) が返すもの
 *   lines[n].cells[p] = null | { type, parts:[{i,len,ch}], hang:[{i,len,ch}] }
 *     type … char=全角1字 / half=半角1字 / pair=半角2字（横書き） / tcy=縦中横（縦書きの2けた）
 *            kk=「。」と「」」の同居 / indent=自動の1マスあけ
 *     hang … 行頭に来てしまった句読点・閉じかぎを、前の行の最後のマスに入れたもの
 *   caret[i] = {line, pos}   … 文字の位置 i のカーソルが立つマス（pos が perLine のときは行の終わり）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Masu = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var KUTOUTEN = "。、．，";
  var CLOSE = "」』）〕］｝〉》】";
  var OPEN = "「『（〔［｛〈《【";
  var KAIWA_OPEN = "「『";

  var DEFAULT_RULES = {
    kutenKagi: true,    // 「。」と「」」を同じマスに入れる
    gyotou: "in",       // 行頭に来た句読点・閉じかぎ： in=前の行の最後のマスの中 / out=マスの外 / off=そのまま
    kaiwaSage: false,   // 会話文の2行目から1マス下げる
    danrakuSage: false, // 段落のはじめを自動で1マスあける
    hankaku2: true      // 半角の数字と小文字は2字で1マス（縦書きは2けたの数字だけ縦中横）
  };

  var segmenter = null;
  try {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
    }
  } catch (e) { segmenter = null; }

  /** 文字列を「見た目の1字」ごとに分ける。i は元の文字列での位置（UTF-16）。 */
  function graphemes(text) {
    var out = [];
    if (segmenter) {
      var it = segmenter.segment(text)[Symbol.iterator]();
      for (var s = it.next(); !s.done; s = it.next()) {
        out.push({ i: s.value.index, len: s.value.segment.length, ch: s.value.segment });
      }
      return out;
    }
    for (var i = 0; i < text.length;) {
      var cp = text.codePointAt(i);
      var l = cp > 0xffff ? 2 : 1;
      out.push({ i: i, len: l, ch: text.substr(i, l) });
      i += l;
    }
    return out;
  }

  function isHalf(ch) { return /^[\x21-\x7e]$/.test(ch); }
  function isPairable(ch) { return /^[0-9a-z.,]$/.test(ch); }
  function isDigit(ch) { return /^[0-9]$/.test(ch); }
  function isSpace(ch) { return /^\s$/.test(ch); }

  function mergeRules(r) {
    var o = {}, k;
    for (k in DEFAULT_RULES) o[k] = DEFAULT_RULES[k];
    if (r) for (k in r) if (r[k] !== undefined) o[k] = r[k];
    return o;
  }

  /** 1段落ぶんの字を「1マスに入るまとまり」に分ける。 */
  function toUnits(pg, dir, rules) {
    var out = [], n = pg.length, k = 0;
    while (k < n) {
      var g = pg[k];
      if (rules.hankaku2 && isPairable(g.ch) && isDigitOrLower(g.ch)) {
        var run = [];
        while (k < n && isPairable(pg[k].ch)) { run.push(pg[k]); k++; }
        if (dir === "h") {
          for (var a = 0; a < run.length; a += 2) {
            out.push({ type: run[a + 1] ? "pair" : "half", parts: run.slice(a, a + 2) });
          }
        } else if (run.length === 2 && isDigit(run[0].ch) && isDigit(run[1].ch)) {
          out.push({ type: "tcy", parts: run });
        } else {
          for (var b = 0; b < run.length; b++) out.push({ type: "half", parts: [run[b]] });
        }
        continue;
      }
      if (rules.kutenKagi && KUTOUTEN.indexOf(g.ch) >= 0 && k + 1 < n && CLOSE.indexOf(pg[k + 1].ch) >= 0) {
        out.push({ type: "kk", parts: [g, pg[k + 1]] });
        k += 2;
        continue;
      }
      out.push({ type: isHalf(g.ch) ? "half" : "char", parts: [g] });
      k++;
    }
    return out;
  }
  function isDigitOrLower(ch) { return /^[0-9a-z]$/.test(ch); }

  function isGyotouNg(u) {
    for (var k = 0; k < u.parts.length; k++) {
      if ((KUTOUTEN + CLOSE).indexOf(u.parts[k].ch) < 0) return false;
    }
    return u.parts.length > 0;
  }

  function layout(text, opts) {
    text = text || "";
    opts = opts || {};
    var perLine = Math.max(1, opts.perLine | 0);
    var dir = opts.dir === "h" ? "h" : "v";
    var rules = mergeRules(opts.rules);

    var gs = graphemes(text);
    var paras = [[]], paraEnds = [];
    for (var x = 0; x < gs.length; x++) {
      if (gs[x].ch === "\n") { paraEnds.push(gs[x].i); paras.push([]); }
      else paras[paras.length - 1].push(gs[x]);
    }

    var lines = [];
    var caret = new Array(text.length + 1);
    var li = -1, pos = 0;

    function newLine(p, start) {
      var cells = [];
      for (var c = 0; c < perLine; c++) cells.push(null);
      lines.push({ cells: cells, para: p, eol: null });
      li = lines.length - 1;
      pos = start;
    }
    function markCaret(parts, line, p) {
      for (var a = 0; a < parts.length; a++) {
        for (var b = 0; b < parts[a].len; b++) caret[parts[a].i + b] = { line: line, pos: p };
      }
    }

    for (var p = 0; p < paras.length; p++) {
      var pg = paras[p];
      var units = toUnits(pg, dir, rules);
      var first = pg.length ? pg[0].ch : "";
      var sage = (rules.kaiwaSage && first && KAIWA_OPEN.indexOf(first) >= 0 && perLine > 1) ? 1 : 0;
      var ind = (rules.danrakuSage && first && OPEN.indexOf(first) < 0 && !isSpace(first) && perLine > 1) ? 1 : 0;

      newLine(p, ind);
      if (ind) lines[li].cells[0] = { type: "indent", parts: [], hang: [] };

      for (var u = 0; u < units.length; u++) {
        var unit = units[u];
        if (pos >= perLine) {
          if (rules.gyotou !== "off" && isGyotouNg(unit)) {
            var last = lines[li].cells[perLine - 1];
            if (last && last.type !== "indent") {
              for (var h = 0; h < unit.parts.length; h++) last.hang.push(unit.parts[h]);
              markCaret(unit.parts, li, perLine);
              continue;
            }
          }
          newLine(p, sage);
        }
        lines[li].cells[pos] = { type: unit.type, parts: unit.parts, hang: [] };
        markCaret(unit.parts, li, pos);
        pos++;
      }

      var endOffset = p < paraEnds.length ? paraEnds[p] : text.length;
      caret[endOffset] = { line: li, pos: pos };
      lines[li].eol = endOffset;
    }

    // 念のため、埋まっていない位置は直前の値で埋める
    var prev = { line: 0, pos: 0 };
    for (var c2 = 0; c2 <= text.length; c2++) {
      if (caret[c2]) prev = caret[c2]; else caret[c2] = prev;
    }

    return { lines: lines, caret: caret, perLine: perLine, dir: dir, rules: rules };
  }

  /** マス (line,pos) をクリックしたときの、文字の位置を返す。 */
  function indexAt(res, line, pos, textLen) {
    if (line < 0) return 0;
    if (line >= res.lines.length) return textLen;
    var ln = res.lines[line];
    pos = Math.max(0, Math.min(res.perLine - 1, pos));
    var cell = ln.cells[pos];
    if (cell && cell.parts.length) return cell.parts[0].i;
    // 手前の空き（字下げ）をクリックしたら、その行の最初の字へ
    var firstReal = -1, lastReal = -1;
    for (var k = 0; k < res.perLine; k++) {
      if (ln.cells[k] && ln.cells[k].parts.length) { if (firstReal < 0) firstReal = k; lastReal = k; }
    }
    if (firstReal >= 0 && pos < firstReal) return ln.cells[firstReal].parts[0].i;
    // 行の終わりより先をクリックしたら、行の終わりへ
    if (ln.eol !== null) return ln.eol;
    if (lastReal >= 0) {
      var c = ln.cells[lastReal];
      var tail = c.hang.length ? c.hang[c.hang.length - 1] : c.parts[c.parts.length - 1];
      return tail.i + tail.len;
    }
    return textLen;
  }

  /** いまの文字数で必要な行数。 */
  function neededLines(res) { return res.lines.length; }

  /**
   * 文字を打ちかえたとき、1字ごとの書式を新しい文字列に合わせて付けかえる。
   * 前と後ろの共通部分はそのまま、入れかわった所には直前の字の書式を引きつぐ（囲みは引きつがない）。
   */
  function adjustStyles(styles, oldText, newText) {
    styles = (styles || []).slice(0, oldText.length);
    while (styles.length < oldText.length) styles.push(null);
    if (oldText === newText) return styles;
    var ol = oldText.length, nl = newText.length;
    var p = 0;
    while (p < ol && p < nl && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
    var s = 0;
    while (s < ol - p && s < nl - p && oldText.charCodeAt(ol - 1 - s) === newText.charCodeAt(nl - 1 - s)) s++;
    var del = ol - p - s, ins = nl - p - s;
    var inherit = null;
    if (p > 0 && oldText[p - 1] !== "\n" && styles[p - 1]) {
      inherit = {};
      for (var k in styles[p - 1]) if (k !== "box") inherit[k] = styles[p - 1][k];
      if (!Object.keys(inherit).length) inherit = null;
    }
    var add = [];
    for (var a = 0; a < ins; a++) {
      add.push(newText[p + a] === "\n" || !inherit ? null : clone(inherit));
    }
    Array.prototype.splice.apply(styles, [p, del].concat(add));
    return styles;
  }
  function clone(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  /** [s,e) の字に書式を重ねる。値が null のキーは消す。 */
  function applyStyle(styles, textLen, s, e, patch) {
    styles = (styles || []).slice(0, textLen);
    while (styles.length < textLen) styles.push(null);
    for (var i = s; i < e; i++) {
      var o = styles[i] ? clone(styles[i]) : {};
      for (var k in patch) { if (patch[k] === null || patch[k] === false) delete o[k]; else o[k] = patch[k]; }
      styles[i] = Object.keys(o).length ? o : null;
    }
    return styles;
  }

  return {
    DEFAULT_RULES: DEFAULT_RULES,
    graphemes: graphemes,
    layout: layout,
    indexAt: indexAt,
    neededLines: neededLines,
    adjustStyles: adjustStyles,
    applyStyle: applyStyle
  };
});
