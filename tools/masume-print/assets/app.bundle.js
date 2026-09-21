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

;
/* hissan.js — 筆算を最後まで解いて、「どのマスに何を書くか」を返す。
 * 画面には触らない。ブラウザとNodeのテストの両方から使う。
 *
 * solve("92÷4") が返すもの
 *   cols, rows        … 答えまで書いたときのマスの数
 *   reserveRows       … 子どもが省かずに書いたときに要る行数（問題だけを刷るときの方眼の高さ）
 *   cells[]           … {r, c, ch, role, point, strike}  role は given（問題）か answer（答えと途中）
 *   rules[]           … {r, c0, c1, role}  r 行目の上の辺に引く横線
 *   bracket           … わり算の「 ) 」の位置 {r, c}（c 列目の左の辺）
 *   answer            … 答えの文字列
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Hissan = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function normalize(src) {
    return String(src || "")
      .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xfee0); })
      .replace(/[．]/g, ".")
      .replace(/[＋]/g, "+")
      .replace(/[－−‐–]/g, "-")
      .replace(/[×✕✖＊xX]/g, "*")
      .replace(/[÷／]/g, "/")
      .replace(/\s+/g, "");
  }

  function parseExpr(src) {
    var m = /^(\d+(?:\.\d+)?)([+\-*\/])(\d+(?:\.\d+)?)$/.exec(normalize(src));
    if (!m) return null;
    var op = { "+": "add", "-": "sub", "*": "mul", "/": "div" }[m[2]];
    return { op: op, a: m[1], b: m[3] };
  }

  function splitNum(s) {
    var m = s.split(".");
    return { int: m[0].replace(/^0+(?=\d)/, ""), frac: m[1] || "" };
  }
  function stripInt(s) { return s.replace(/^0+(?=\d)/, ""); }

  function putRight(cells, str, r, endCol, role) {
    for (var k = 0; k < str.length; k++) {
      cells.push({ r: r, c: endCol - (str.length - 1 - k), ch: str[k], role: role });
    }
  }

  function solveAddSub(op, a, b) {
    var A = splitNum(a), B = splitNum(b);
    var F = Math.max(A.frac.length, B.frac.length);
    var sa = BigInt(A.int + A.frac + zeros(F - A.frac.length));
    var sb = BigInt(B.int + B.frac + zeros(F - B.frac.length));
    if (op === "sub" && sa < sb) return { ok: false, error: "ひく数のほうが大きくなっています。" };
    var sr = (op === "add" ? sa + sb : sa - sb).toString();
    while (sr.length < F + 1) sr = "0" + sr;
    var R = { int: sr.slice(0, sr.length - F), frac: F ? sr.slice(sr.length - F) : "" };
    // くり上がって1けた増えた答えは、記号の列の下に入る（教科書の書き方）
    var I = Math.max(A.int.length, B.int.length);
    var cols = Math.max(1 + I + F, R.int.length + F);
    var ones = cols - 1 - F;
    var cells = [], rules = [];

    function put(n, r, role, isResult) {
      var trailing = 0;
      if (isResult && n.frac) { var m = /0+$/.exec(n.frac); trailing = m ? m[0].length : 0; }
      for (var k = 0; k < n.int.length; k++) {
        var cell = { r: r, c: ones - (n.int.length - 1 - k), ch: n.int[k], role: role };
        if (k === n.int.length - 1 && n.frac.length) {
          cell.point = true;
          if (isResult && trailing === n.frac.length) cell.pointStrike = true;
        }
        cells.push(cell);
      }
      for (var f = 0; f < n.frac.length; f++) {
        var fc = { r: r, c: ones + 1 + f, ch: n.frac[f], role: role };
        if (isResult && f >= n.frac.length - trailing) fc.strike = true;
        cells.push(fc);
      }
    }
    put(A, 0, "given", false);
    put(B, 1, "given", false);
    cells.push({ r: 1, c: 0, ch: op === "add" ? "+" : "−", role: "given", sign: true });
    rules.push({ r: 2, c0: 0, c1: cols - 1, role: "given" });
    put(R, 2, "answer", true);

    var ans = R.int + (R.frac.replace(/0+$/, "") ? "." + R.frac.replace(/0+$/, "") : "");
    return { ok: true, op: op, a: a, b: b, cols: cols, rows: 3, reserveRows: 3,
             cells: cells, rules: rules, bracket: null, answer: ans };
  }
  function zeros(n) { var s = ""; while (s.length < n) s += "0"; return s; }

  function solveMul(a, b) {
    if (a.indexOf(".") >= 0 || b.indexOf(".") >= 0) {
      return { ok: false, error: "かけ算の筆算は、いまは整数だけに対応しています。" };
    }
    var A = BigInt(a), B = BigInt(b);
    var sa = A.toString(), sb = B.toString(), res = (A * B).toString();
    // 答えのいちばん上のけたは、記号の列の下に入ってよい（教科書の書き方）
    var cols = Math.max(1 + Math.max(sa.length, sb.length), res.length), end = cols - 1;
    var cells = [], rules = [];
    putRight(cells, sa, 0, end, "given");
    putRight(cells, sb, 1, end, "given");
    cells.push({ r: 1, c: 0, ch: "×", role: "given", sign: true });
    rules.push({ r: 2, c0: 0, c1: end, role: "given" });

    var partial = [];
    for (var j = 0; j < sb.length; j++) {
      var d = sb[sb.length - 1 - j];
      if (d !== "0") partial.push({ j: j, val: (A * BigInt(d)).toString() });
    }
    var rows;
    if (sb.length === 1 || partial.length <= 1) {
      putRight(cells, res, 2, end, "answer");
      rows = 3;
    } else {
      for (var p = 0; p < partial.length; p++) {
        putRight(cells, partial[p].val, 2 + p, end - partial[p].j, "answer");
      }
      rules.push({ r: 2 + partial.length, c0: 0, c1: end, role: "answer" });
      putRight(cells, res, 2 + partial.length, end, "answer");
      rows = 3 + partial.length;
    }
    var reserve = sb.length === 1 ? 3 : 2 + sb.length + 1;
    return { ok: true, op: "mul", a: a, b: b, cols: cols, rows: rows, reserveRows: Math.max(rows, reserve),
             cells: cells, rules: rules, bracket: null, answer: res };
  }

  function solveDiv(a, b, opts) {
    if (a.indexOf(".") >= 0 || b.indexOf(".") >= 0) {
      return { ok: false, error: "わり算の筆算は、いまは整数だけに対応しています。" };
    }
    var Bn = BigInt(b);
    if (Bn === 0n) return { ok: false, error: "0でわることはできません。" };
    var skipZero = !(opts && opts.zeroStep === "write");
    var sa = stripInt(a), sb = Bn.toString();
    var nb = sb.length, na = sa.length, cols = nb + na;
    var cells = [], rules = [];
    putRight(cells, sb, 1, nb - 1, "given");
    putRight(cells, sa, 1, cols - 1, "given");
    rules.push({ r: 1, c0: nb, c1: cols - 1, role: "given", vinculum: true });

    var cur = 0n, started = false, subtracted = false, r = 2, steps = 0, q = "";
    for (var k = 0; k < na; k++) {
      cur = cur * 10n + BigInt(sa[k]);
      var qd = cur / Bn;
      if (!started && qd === 0n && k < na - 1) continue;
      started = true;
      steps++;
      q += qd.toString();
      cells.push({ r: 0, c: nb + k, ch: qd.toString(), role: "answer" });
      if (qd === 0n && skipZero) continue;
      var curStr = cur.toString();
      if (subtracted) { putRight(cells, curStr, r, nb + k, "answer"); r++; }
      var prod = (qd * Bn).toString();
      putRight(cells, prod, r, nb + k, "answer");
      r++;
      rules.push({ r: r, c0: nb + k - (Math.max(curStr.length, prod.length) - 1), c1: nb + k, role: "answer" });
      cur = cur - qd * Bn;
      subtracted = true;
    }
    if (subtracted) { putRight(cells, cur.toString(), r, cols - 1, "answer"); r++; }
    var rows = r;
    var reserve = 2 + steps * 2;
    var ans = q + (cur > 0n ? " あまり " + cur.toString() : "");
    return { ok: true, op: "div", a: a, b: b, cols: cols, rows: rows, reserveRows: Math.max(rows, reserve),
             cells: cells, rules: rules, bracket: { r: 1, c: nb }, answer: ans,
             quotient: q, remainder: cur.toString() };
  }

  function solve(src, opts) {
    var e = typeof src === "string" ? parseExpr(src) : src;
    if (!e) return { ok: false, error: "式は「92÷4」「345+278」のように、数と記号1つで入れてください。" };
    if (e.a.replace(".", "").length > 9 || e.b.replace(".", "").length > 9) {
      return { ok: false, error: "けた数が多すぎます（9けたまで）。" };
    }
    if (e.op === "add" || e.op === "sub") return solveAddSub(e.op, e.a, e.b);
    if (e.op === "mul") return solveMul(e.a, e.b);
    return solveDiv(e.a, e.b, opts);
  }

  return { normalize: normalize, parseExpr: parseExpr, solve: solve };
});

;
/* shiki.js — 式の文字列を部品に分ける（分数・帯分数・□・記号）。
 * 画面には触らない。ブラウザとNodeのテストの両方から使う。
 *
 *   "1と2/3 + 3/4 = □"  →  [mixed(1, 2/3), op(+), frac(3/4), op(=), box(1)]
 *
 * 書き方のきまり
 *   分数 … 2/3        帯分数 … 1と2/3        わり算は ÷ を使う（/ は分数）
 *   □   … 答えを書くわく。続けて打つと横に広がる
 *   * は × に、- は − に直して出す
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Shiki = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var OPS = { "+": "+", "-": "−", "*": "×", "×": "×", "÷": "÷", "=": "=", "<": "<", ">": ">", "≦": "≦", "≧": "≧" };
  var PART = "[0-9□○△A-Za-z]+";

  function normalize(src) {
    return String(src || "")
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xfee0); })
      .replace(/[．]/g, ".")
      .replace(/[＋]/g, "+")
      .replace(/[－−]/g, "-")
      .replace(/[＊]/g, "*")
      .replace(/[／]/g, "/")
      .replace(/[＝]/g, "=")
      .replace(/[（]/g, "(")
      .replace(/[）]/g, ")");
  }

  function parse(src) {
    var s = normalize(src), out = [], m;
    var reMixed = new RegExp("^([0-9]+)\\s*と\\s*(" + PART + ")\\/(" + PART + ")");
    var reFrac = new RegExp("^(" + PART + ")\\/(" + PART + ")");
    while (s.length) {
      if ((m = /^\s+/.exec(s))) { s = s.slice(m[0].length); continue; }
      if ((m = reMixed.exec(s))) { out.push({ t: "mixed", whole: m[1], num: m[2], den: m[3] }); s = s.slice(m[0].length); continue; }
      if ((m = reFrac.exec(s))) { out.push({ t: "frac", num: m[1], den: m[2] }); s = s.slice(m[0].length); continue; }
      if ((m = /^[0-9]+(?:\.[0-9]+)?/.exec(s))) { out.push({ t: "num", v: m[0] }); s = s.slice(m[0].length); continue; }
      if ((m = /^□+/.exec(s))) { out.push({ t: "box", n: m[0].length }); s = s.slice(m[0].length); continue; }
      if (OPS[s[0]]) { out.push({ t: "op", v: OPS[s[0]] }); s = s.slice(1); continue; }
      if (s[0] === "(" || s[0] === ")") { out.push({ t: "paren", v: s[0] }); s = s.slice(1); continue; }
      // そのほかの字（単位・あまり・文字式など）はまとめてそのまま出す
      m = /^[^\s0-9□+\-*×÷=<>≦≧()]+/.exec(s);
      var txt = m ? m[0] : s[0];
      out.push({ t: "text", v: txt });
      s = s.slice(txt.length);
    }
    return out;
  }

  return { normalize: normalize, parse: parse };
});

;
/* 教科の事例。examples/*.json から tests/build-examples.mjs が作りなおす。手で書きかえない。 */
window.MASUME_EXAMPLES = [{"key":"kokugo-1nen-nazori","name":"国語 1年　ひらがなの なぞりがき（A4 たて）","subject":"国語","grade":"1年","title":"ひらがなの なぞりがき","note":"うすい字をなぞってから、同じ数のマスに自分で書く練習です。","paper":"A4 たて","pages":1,"doc":{"version":1,"title":"ひらがなの なぞりがき","paper":"A4","orient":"portrait","margin":10,"snap":1,"meta":{"subject":"国語","grade":"1年","name":"ひらがなの なぞりがき","note":"うすい字をなぞってから、同じ数のマスに自分で書く練習です。"},"pages":[{"blocks":[{"type":"text","x":10,"y":10,"w":90,"h":14.5,"size":20,"bold":true,"html":"ひらがなの　なぞりがき"},{"type":"text","x":105,"y":11,"w":95,"h":10,"size":12,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":23,"x2":200,"y2":23,"color":"#1b1b1b","width":0.5},{"type":"text","x":10,"y":28,"w":190,"h":11,"size":14,"html":"みぎの　うすい　じを　なぞって、ひだりに　じぶんで　かきましょう。"},{"type":"masu","x":10,"y":66,"dir":"v","cell":20,"perLine":3,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":""},{"type":"masu","x":30,"y":66,"dir":"v","cell":20,"perLine":3,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":"つくえ","color":"#b9bcc0","fontScale":0.88},{"type":"masu","x":70,"y":66,"dir":"v","cell":20,"perLine":3,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":""},{"type":"masu","x":90,"y":66,"dir":"v","cell":20,"perLine":3,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":"とけい","color":"#b9bcc0","fontScale":0.88},{"type":"masu","x":130,"y":66,"dir":"v","cell":20,"perLine":4,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":""},{"type":"masu","x":150,"y":66,"dir":"v","cell":20,"perLine":4,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":"えんぴつ","color":"#b9bcc0","fontScale":0.88},{"type":"masu","x":10,"y":173,"dir":"v","cell":20,"perLine":4,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":""},{"type":"masu","x":30,"y":173,"dir":"v","cell":20,"perLine":4,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":"けしごむ","color":"#b9bcc0","fontScale":0.88},{"type":"masu","x":70,"y":173,"dir":"v","cell":20,"perLine":5,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":""},{"type":"masu","x":90,"y":173,"dir":"v","cell":20,"perLine":5,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":"らんどせる","color":"#b9bcc0","fontScale":0.88},{"type":"masu","x":130,"y":173,"dir":"v","cell":20,"perLine":3,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":""},{"type":"masu","x":150,"y":173,"dir":"v","cell":20,"perLine":3,"lines":1,"leader":true,"frame":true,"gridColor":"green","text":"はさみ","color":"#b9bcc0","fontScale":0.88},{"type":"text","x":10,"y":278,"w":190,"h":8,"size":8,"align":"end","html":"© School Stock"}]}]}},{"key":"kokugo-2nen-kagi","name":"国語 2年　かぎ（「 」）のつかいかた（B4 よこ）","subject":"国語","grade":"2年","title":"かぎ（「 」）のつかいかた","note":"会話文の「かぎ」の使い方を、視写で身につけるプリントです。","paper":"B4 よこ","pages":1,"doc":{"version":1,"title":"かぎの つかいかた（2年）","paper":"B4","orient":"landscape","margin":10,"snap":1,"meta":{"subject":"国語","grade":"2年","name":"かぎ（「 」）のつかいかた","note":"会話文の「かぎ」の使い方を、視写で身につけるプリントです。"},"pages":[{"blocks":[{"type":"text","x":10,"y":10,"w":220,"h":14.5,"dir":"h","html":"かぎ（「 」）の つかいかた","size":20,"bold":true,"align":"start"},{"type":"text","x":254,"y":11,"w":100,"h":10,"dir":"h","html":"　年　組　名前（　　　　　　　　　　）","size":12,"align":"start"},{"type":"line","x1":10,"y1":26,"x2":354,"y2":26,"color":"#1b1b1b","width":0.5,"dash":"solid"},{"type":"text","x":10,"y":30,"w":344,"h":10,"dir":"h","html":"めあて　かぎ（「 」）を 正しく つかって 書きましょう。","size":12,"align":"start"},{"type":"text","x":20,"y":45,"w":90,"h":10,"dir":"h","html":"ここに　かきうつしましょう","size":12,"align":"center"},{"type":"text","x":254,"y":45,"w":90,"h":10,"dir":"h","html":"手本（読みましょう）","size":12,"align":"center"},{"type":"masu","x":20,"y":60,"dir":"v","cell":15,"perLine":10,"lines":6,"gap":0,"leader":true,"frame":true,"lineStyle":"solid","gridColor":"green","text":"","styles":[],"fontScale":0.82,"font":"kyokasho","color":"#1b1b1b","autoGrow":false},{"type":"masu","x":254,"y":60,"dir":"v","cell":15,"perLine":10,"lines":6,"gap":0,"leader":false,"frame":true,"lineStyle":"solid","gridColor":"green","text":"公園で　あいました。\n「いっしょに　あそぼう。」\nと、さそわれました。\n「いいよ。」\nと、へんじしました。","styles":[null,null,null,null,null,null,null,null,null,null,null,{"color":"#1d5fbf"},null,null,null,null,null,null,null,null,null,null,null,{"color":"#1d5fbf"},null,null,null,null,null,null,null,null,null,null,null,null,{"color":"#1d5fbf"},null,null,null,null,{"color":"#1d5fbf"},null,null,null,null,null,null,null,null,null,null,null],"fontScale":0.82,"font":"kyokasho","color":"#1b1b1b","autoGrow":false,"rules":{"kutenKagi":true,"gyotou":"in","kaiwaSage":true,"danrakuSage":false,"hankaku2":true}},{"type":"text","x":118,"y":60,"w":128,"h":48,"dir":"h","size":13,"align":"start","html":"<b>かぎを つかう ときの きまり</b><div>① 話した ことばは、「 」で かこみます。</div><div>② 「 」も、1つの マスに 1字 書きます。</div><div>③ まる（。）と とじかぎ（」）は、同じ マスに 書きます。</div>","border":"solid","fill":"none","pad":5},{"type":"text","x":254,"y":239,"w":100,"h":8,"dir":"h","html":"© School Stock","size":8,"align":"end"}]}]}},{"key":"kokugo-4nen-youyaku","name":"国語 4年　文章要約（100字）（A4 たて）","subject":"国語","grade":"4年","title":"文章要約（100字）","note":"せつめい文を読み、いちばん伝えたいことを100字でまとめる練習です。","paper":"A4 たて","pages":1,"doc":{"version":1,"title":"文章を読んで100字でまとめる（4年）","paper":"A4","orient":"portrait","margin":10,"snap":1,"meta":{"subject":"国語","grade":"4年","name":"文章要約（100字）","note":"せつめい文を読み、いちばん伝えたいことを100字でまとめる練習です。"},"pages":[{"blocks":[{"type":"text","x":10,"y":10,"w":110,"h":11.5,"dir":"h","html":"文章を読んで、100字でまとめよう","size":15,"bold":true,"align":"start"},{"type":"text","x":125,"y":11,"w":75,"h":9,"dir":"h","html":"　年　組　名前（　　　　　　　　　　）","size":10,"align":"start"},{"type":"line","x1":10,"y1":25,"x2":200,"y2":25,"color":"#1b1b1b","width":0.5,"dash":"solid"},{"type":"text","x":10,"y":29,"w":190,"h":10,"dir":"h","html":"めあて　文章を読んで、いちばん伝えたいことを100字でまとめよう。","size":12,"align":"start"},{"type":"text","x":15,"y":45,"w":180,"h":84,"dir":"h","size":14,"lineHeight":1.8,"align":"start","font":"kyokasho","color":"#1b1b1b","border":"solid","fill":"none","pad":4,"html":"わたしたちが使った新聞紙やノートは、そのままごみになるのではなく、多くが紙こうじょうへ運ばれて、新しい紙に生まれ変わります。まず、紙は水にとかされて、どろどろのパルプにもどされます。次に、インクやほこりなどのよごれを取りのぞきます。そのあと、うすくのばして、かわかしながら大きなロールにまき取ると、真新しい紙ができあがります。こうしてできた紙は、また新聞紙やノート、ダンボールなどにすがたを変えて、わたしたちのもとにもどってきます。かぎられた木を大切に使うために、紙を分別して出すことは、だれにでもできる身近な取り組みです。"},{"type":"text","x":10,"y":135,"w":190,"h":15,"dir":"h","size":12,"align":"start","border":"solid","fill":"none","pad":4,"html":"もんだい　筆者がいちばん伝えたいことを、100字以内でまとめましょう。"},{"type":"masu","x":55,"y":156,"dir":"v","cell":10,"perLine":10,"lines":10,"gap":0,"leader":true,"frame":true,"lineStyle":"solid","gridColor":"green","text":"","styles":[],"fontScale":0.78,"font":"kyokasho","color":"#1b1b1b","autoGrow":false},{"type":"text","x":100,"y":263,"w":100,"h":8,"dir":"h","html":"© School Stock","size":8,"align":"end"}]}]}},{"key":"sansu-4nen-warizan","name":"算数 4年　わり算の筆算（B4 よこ）","subject":"算数","grade":"4年","title":"わり算の筆算","note":"2けたと3けたのわり算の筆算を、やさしい順に練習できます。","paper":"B4 よこ","pages":2,"doc":{"version":1,"title":"わり算の筆算","paper":"B4","orient":"landscape","margin":10,"snap":1,"meta":{"subject":"算数","grade":"4年","name":"わり算の筆算","note":"2けたと3けたのわり算の筆算を、やさしい順に練習できます。"},"pages":[{"blocks":[{"type":"text","x":10,"y":10,"w":150,"h":14.5,"size":20,"bold":true,"html":"わり算の筆算"},{"type":"text","x":250,"y":11,"w":94,"h":10,"size":12,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":25,"x2":354,"y2":25,"color":"#1b1b1b","width":0.5},{"type":"text","x":10,"y":29,"w":250,"h":10,"size":12,"html":"めあて　わり算の筆算を、やさしい順に練習しよう。"},{"type":"text","x":10,"y":41,"w":40,"h":11,"size":14,"html":"（1）"},{"type":"hissan","x":15,"y":52,"expr":"48÷4","mode":"problem","cell":10,"grid":"hougan"},{"type":"text","x":65,"y":41,"w":40,"h":11,"size":14,"html":"（2）"},{"type":"hissan","x":70,"y":52,"expr":"96÷3","mode":"problem","cell":10,"grid":"hougan"},{"type":"text","x":120,"y":41,"w":40,"h":11,"size":14,"html":"（3）"},{"type":"hissan","x":125,"y":52,"expr":"79÷3","mode":"problem","cell":10,"grid":"hougan"},{"type":"text","x":175,"y":41,"w":40,"h":11,"size":14,"html":"（4）"},{"type":"hissan","x":180,"y":52,"expr":"88÷5","mode":"problem","cell":10,"grid":"hougan"},{"type":"text","x":10,"y":119,"w":40,"h":11,"size":14,"html":"（5）"},{"type":"hissan","x":15,"y":130,"expr":"636÷3","mode":"problem","cell":10,"grid":"hougan"},{"type":"text","x":65,"y":119,"w":40,"h":11,"size":14,"html":"（6）"},{"type":"hissan","x":70,"y":130,"expr":"428÷4","mode":"problem","cell":10,"grid":"hougan"},{"type":"text","x":120,"y":119,"w":40,"h":11,"size":14,"html":"（7）"},{"type":"hissan","x":125,"y":130,"expr":"527÷4","mode":"problem","cell":10,"grid":"hougan"},{"type":"text","x":175,"y":119,"w":40,"h":11,"size":14,"html":"（8）"},{"type":"hissan","x":180,"y":130,"expr":"619÷6","mode":"problem","cell":10,"grid":"hougan"},{"type":"rect","x":230,"y":38,"w":120,"h":106,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"text","x":240,"y":44,"w":104,"h":11,"size":14,"bold":true,"html":"（9）文章題"},{"type":"text","x":240,"y":60,"w":104,"h":33,"size":13,"html":"ビーズが146こあります。<div>1つのふくろに9こずつ入れると、</div><div>何ふくろできて、何こあまりますか。</div><div>式と答えを書きましょう。</div>"},{"type":"text","x":240,"y":98,"w":104,"h":10,"size":11,"html":"式"},{"type":"line","x1":240,"y1":112,"x2":344,"y2":112,"color":"#1b1b1b","width":0.5},{"type":"text","x":240,"y":120,"w":104,"h":11,"size":13,"html":"答え（　　　　　　　　　　　　　　　　）"},{"type":"text","x":244,"y":236,"w":100,"h":8,"size":8,"align":"end","html":"© School Stock"}]},{"blocks":[{"type":"text","x":10,"y":10,"w":150,"h":14.5,"size":20,"bold":true,"html":"わり算の筆算　（かいとう）"},{"type":"text","x":250,"y":11,"w":94,"h":10,"size":12,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":25,"x2":354,"y2":25,"color":"#1b1b1b","width":0.5},{"type":"text","x":10,"y":29,"w":250,"h":10,"size":12,"html":"めあて　わり算の筆算を、やさしい順に練習しよう。"},{"type":"text","x":10,"y":41,"w":40,"h":11,"size":14,"html":"（1）"},{"type":"hissan","x":15,"y":52,"expr":"48÷4","mode":"answer","cell":10,"grid":"hougan","ansColor":"#d12a1e"},{"type":"text","x":65,"y":41,"w":40,"h":11,"size":14,"html":"（2）"},{"type":"hissan","x":70,"y":52,"expr":"96÷3","mode":"answer","cell":10,"grid":"hougan","ansColor":"#d12a1e"},{"type":"text","x":120,"y":41,"w":40,"h":11,"size":14,"html":"（3）"},{"type":"hissan","x":125,"y":52,"expr":"79÷3","mode":"answer","cell":10,"grid":"hougan","ansColor":"#d12a1e"},{"type":"text","x":175,"y":41,"w":40,"h":11,"size":14,"html":"（4）"},{"type":"hissan","x":180,"y":52,"expr":"88÷5","mode":"answer","cell":10,"grid":"hougan","ansColor":"#d12a1e"},{"type":"text","x":10,"y":119,"w":40,"h":11,"size":14,"html":"（5）"},{"type":"hissan","x":15,"y":130,"expr":"636÷3","mode":"answer","cell":10,"grid":"hougan","ansColor":"#d12a1e"},{"type":"text","x":65,"y":119,"w":40,"h":11,"size":14,"html":"（6）"},{"type":"hissan","x":70,"y":130,"expr":"428÷4","mode":"answer","cell":10,"grid":"hougan","ansColor":"#d12a1e"},{"type":"text","x":120,"y":119,"w":40,"h":11,"size":14,"html":"（7）"},{"type":"hissan","x":125,"y":130,"expr":"527÷4","mode":"answer","cell":10,"grid":"hougan","ansColor":"#d12a1e"},{"type":"text","x":175,"y":119,"w":40,"h":11,"size":14,"html":"（8）"},{"type":"hissan","x":180,"y":130,"expr":"619÷6","mode":"answer","cell":10,"grid":"hougan","ansColor":"#d12a1e"},{"type":"rect","x":230,"y":38,"w":120,"h":106,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"text","x":240,"y":44,"w":104,"h":11,"size":14,"bold":true,"html":"（9）文章題"},{"type":"text","x":240,"y":60,"w":104,"h":33,"size":13,"html":"ビーズが146こあります。<div>1つのふくろに9こずつ入れると、</div><div>何ふくろできて、何こあまりますか。</div><div>式と答えを書きましょう。</div>"},{"type":"text","x":240,"y":98,"w":104,"h":10,"size":11,"html":"式"},{"type":"shiki","x":240,"y":109,"src":"146÷9=16あまり2","size":16,"color":"#d12a1e"},{"type":"text","x":240,"y":127,"w":104,"h":11,"size":13,"color":"#d12a1e","html":"答え（16ふくろできて、2こあまる。）"},{"type":"text","x":244,"y":236,"w":100,"h":8,"size":8,"align":"end","html":"© School Stock"}]}]}},{"key":"sansu-5nen-bunsu","name":"算数 5年　分数のたし算とひき算（A4 たて）","subject":"算数","grade":"5年","title":"分数のたし算とひき算","note":"通分がいるたし算・ひき算を8問。帯分数を2問ふくみます。","paper":"A4 たて","pages":2,"doc":{"version":1,"title":"分数のたし算とひき算","paper":"A4","orient":"portrait","margin":10,"snap":1,"meta":{"subject":"算数","grade":"5年","name":"分数のたし算とひき算","note":"通分がいるたし算・ひき算を8問。帯分数を2問ふくみます。"},"pages":[{"blocks":[{"type":"text","x":10,"y":10,"w":95,"h":14.5,"size":20,"bold":true,"html":"分数のたし算とひき算"},{"type":"text","x":105,"y":11,"w":95,"h":10,"size":12,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":23,"x2":200,"y2":23,"color":"#1b1b1b","width":0.5},{"type":"text","x":10,"y":28,"w":180,"h":10,"size":12,"html":"めあて　通分して、分数のたし算とひき算をしよう。"},{"type":"text","x":110,"y":40,"w":30,"h":9,"size":10,"align":"center","html":"答え"},{"type":"text","x":145,"y":40,"w":50,"h":9,"size":10,"align":"center","html":"とちゅうの計算"},{"type":"text","x":10,"y":54,"w":16,"h":11,"size":14,"html":"（1）"},{"type":"shiki","x":28,"y":52,"src":"1/2 + 1/3 =","size":20},{"type":"rect","x":110,"y":51,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"rect","x":145,"y":49,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":80,"w":16,"h":11,"size":14,"html":"（2）"},{"type":"shiki","x":28,"y":78,"src":"1/3 + 1/4 =","size":20},{"type":"rect","x":110,"y":77,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"rect","x":145,"y":75,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":106,"w":16,"h":11,"size":14,"html":"（3）"},{"type":"shiki","x":28,"y":104,"src":"3/4 - 1/6 =","size":20},{"type":"rect","x":110,"y":103,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"rect","x":145,"y":101,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":132,"w":16,"h":11,"size":14,"html":"（4）"},{"type":"shiki","x":28,"y":130,"src":"5/6 - 3/8 =","size":20},{"type":"rect","x":110,"y":129,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"rect","x":145,"y":127,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":158,"w":16,"h":11,"size":14,"html":"（5）"},{"type":"shiki","x":28,"y":156,"src":"5/6 - 7/12 =","size":20},{"type":"rect","x":110,"y":155,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"rect","x":145,"y":153,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":184,"w":16,"h":11,"size":14,"html":"（6）"},{"type":"shiki","x":28,"y":182,"src":"2/3 + 5/6 =","size":20},{"type":"rect","x":110,"y":181,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"rect","x":145,"y":179,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":210,"w":16,"h":11,"size":14,"html":"（7）"},{"type":"shiki","x":28,"y":208,"src":"1と1/4 + 2/3 =","size":20},{"type":"rect","x":110,"y":207,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"rect","x":145,"y":205,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":236,"w":16,"h":11,"size":14,"html":"（8）"},{"type":"shiki","x":28,"y":234,"src":"2と1/6 - 1と1/2 =","size":20},{"type":"rect","x":110,"y":233,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"rect","x":145,"y":231,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":100,"y":278,"w":100,"h":8,"size":8,"align":"end","html":"© School Stock"}]},{"blocks":[{"type":"text","x":10,"y":10,"w":95,"h":14.5,"size":20,"bold":true,"html":"分数のたし算とひき算"},{"type":"text","x":105,"y":11,"w":95,"h":10,"size":12,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":23,"x2":200,"y2":23,"color":"#1b1b1b","width":0.5},{"type":"text","x":10,"y":28,"w":180,"h":10,"size":12,"html":"めあて　通分して、分数のたし算とひき算をしよう。（かいとう）"},{"type":"text","x":110,"y":40,"w":30,"h":9,"size":10,"align":"center","html":"答え"},{"type":"text","x":145,"y":40,"w":50,"h":9,"size":10,"align":"center","html":"とちゅうの計算"},{"type":"text","x":10,"y":54,"w":16,"h":11,"size":14,"html":"（1）"},{"type":"shiki","x":28,"y":52,"src":"1/2 + 1/3 =","size":20},{"type":"rect","x":110,"y":51,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"shiki","x":121.2,"y":52.5,"src":"5/6","size":16,"color":"#d12a1e"},{"type":"rect","x":145,"y":49,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":80,"w":16,"h":11,"size":14,"html":"（2）"},{"type":"shiki","x":28,"y":78,"src":"1/3 + 1/4 =","size":20},{"type":"rect","x":110,"y":77,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"shiki","x":119.3,"y":78.5,"src":"7/12","size":16,"color":"#d12a1e"},{"type":"rect","x":145,"y":75,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":106,"w":16,"h":11,"size":14,"html":"（3）"},{"type":"shiki","x":28,"y":104,"src":"3/4 - 1/6 =","size":20},{"type":"rect","x":110,"y":103,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"shiki","x":119.3,"y":104.5,"src":"7/12","size":16,"color":"#d12a1e"},{"type":"rect","x":145,"y":101,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":132,"w":16,"h":11,"size":14,"html":"（4）"},{"type":"shiki","x":28,"y":130,"src":"5/6 - 3/8 =","size":20},{"type":"rect","x":110,"y":129,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"shiki","x":119.3,"y":130.5,"src":"11/24","size":16,"color":"#d12a1e"},{"type":"rect","x":145,"y":127,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":158,"w":16,"h":11,"size":14,"html":"（5）"},{"type":"shiki","x":28,"y":156,"src":"5/6 - 7/12 =","size":20},{"type":"rect","x":110,"y":155,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"shiki","x":121.2,"y":156.5,"src":"1/4","size":16,"color":"#d12a1e"},{"type":"rect","x":145,"y":153,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":184,"w":16,"h":11,"size":14,"html":"（6）"},{"type":"shiki","x":28,"y":182,"src":"2/3 + 5/6 =","size":20},{"type":"rect","x":110,"y":181,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"shiki","x":119.1,"y":182.5,"src":"1と1/2","size":16,"color":"#d12a1e"},{"type":"rect","x":145,"y":179,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":210,"w":16,"h":11,"size":14,"html":"（7）"},{"type":"shiki","x":28,"y":208,"src":"1と1/4 + 2/3 =","size":20},{"type":"rect","x":110,"y":207,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"shiki","x":117.2,"y":208.5,"src":"1と11/12","size":16,"color":"#d12a1e"},{"type":"rect","x":145,"y":205,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":10,"y":236,"w":16,"h":11,"size":14,"html":"（8）"},{"type":"shiki","x":28,"y":234,"src":"2と1/6 - 1と1/2 =","size":20},{"type":"rect","x":110,"y":233,"w":30,"h":18,"shape":"round","color":"#8a8f96","width":0.4,"fill":"none"},{"type":"shiki","x":121.2,"y":234.5,"src":"2/3","size":16,"color":"#d12a1e"},{"type":"rect","x":145,"y":231,"w":50,"h":20,"shape":"rect","color":"#8a8f96","width":0.3,"fill":"none"},{"type":"text","x":100,"y":278,"w":100,"h":8,"size":8,"align":"end","html":"© School Stock"}]}]}},{"key":"rika-4nen-jikken","name":"理科 4年　実験の記録カード（A4 たて）","subject":"理科","grade":"4年","title":"実験の記録カード","note":"どの単元の実験でも使える記録カードです。","paper":"A4 たて","pages":2,"doc":{"version":1,"title":"実験の記録","paper":"A4","orient":"portrait","margin":10,"snap":1,"meta":{"subject":"理科","grade":"4年","name":"実験の記録カード","note":"どの単元の実験でも使える記録カードです。"},"pages":[{"blocks":[{"type":"text","x":10,"y":10,"w":90,"h":14.5,"size":20,"bold":true,"html":"実験の記録"},{"type":"text","x":110,"y":10,"w":90,"h":10,"size":12,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":27,"x2":200,"y2":27,"width":0.5},{"id":"baxq5or4","type":"text","x":10,"y":36,"w":190,"h":10,"dir":"h","html":"日づけ　　　月　　　日（　　　）　　　　天気（　　　　　　　　　）","size":12,"font":"kyokasho","color":"#1b1b1b","bold":false,"align":"start","lineHeight":1.6,"border":"none","fill":"none","pad":1.5},{"type":"text","x":10,"y":57,"w":180,"h":9,"size":10,"html":"問題（しらべたいこと）を書きましょう。"},{"type":"masu","x":10,"y":68,"dir":"h","cell":10,"perLine":18,"lines":2,"leader":true,"autoGrow":false,"text":""},{"type":"text","x":10,"y":94,"w":180,"h":9,"size":10,"html":"予想と、そのわけを書きましょう。（40字まで）"},{"type":"masu","x":10,"y":105,"dir":"h","cell":10,"perLine":10,"lines":4,"leader":true,"autoGrow":false,"text":""},{"type":"text","x":10,"y":151,"w":180,"h":9,"size":10,"html":"実験の方法を、絵や図でかきましょう。"},{"type":"rect","x":10,"y":162,"w":180,"h":100,"shape":"round","color":"#8a8f96","width":0.4},{"type":"text","x":10,"y":279,"w":190,"h":8,"size":8,"align":"end","html":"© School Stock"}]},{"blocks":[{"type":"text","x":10,"y":10,"w":108,"h":12.5,"size":16,"bold":true,"html":"実験の記録（２まい目）"},{"type":"text","x":120,"y":10,"w":80,"h":10,"size":10,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":24,"x2":200,"y2":24,"width":0.5},{"type":"text","x":10,"y":36,"w":180,"h":9,"size":10,"html":"結果を書きましょう。（40字まで）"},{"type":"masu","x":10,"y":47,"dir":"h","cell":16,"perLine":10,"lines":4,"leader":true,"autoGrow":false,"text":""},{"type":"text","x":10,"y":119,"w":180,"h":9,"size":10,"html":"考察（結果から分かったこと）を書きましょう。（60字まで）"},{"type":"masu","x":10,"y":130,"dir":"h","cell":16,"perLine":10,"lines":6,"leader":true,"autoGrow":false,"text":""},{"type":"text","x":10,"y":279,"w":190,"h":8,"size":8,"align":"end","html":"© School Stock"}]}]}},{"key":"shakai-4nen-kengaku","name":"社会 4年　見学のまとめカード（B4 よこ）","subject":"社会","grade":"4年","title":"見学のまとめカード","note":"どの見学先でも使えるまとめカードです。","paper":"B4 よこ","pages":1,"doc":{"version":1,"title":"見学のまとめカード","paper":"B4","orient":"landscape","margin":10,"snap":1,"meta":{"subject":"社会","grade":"4年","name":"見学のまとめカード","note":"どの見学先でも使えるまとめカードです。"},"pages":[{"blocks":[{"type":"text","x":10,"y":10,"w":160,"h":15.5,"size":22,"bold":true,"html":"見学のまとめカード"},{"type":"text","x":250,"y":10,"w":104,"h":10,"size":12,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":29,"x2":354,"y2":29,"width":0.5},{"type":"text","x":10,"y":34,"w":165,"h":10.5,"size":13,"bold":true,"html":"見学メモ"},{"type":"text","x":10,"y":46,"w":165,"h":9,"size":10,"html":"見たこと・聞いたこと①（30字まで）"},{"type":"masu","x":10,"y":56,"dir":"h","cell":10,"perLine":10,"lines":3,"leader":true,"autoGrow":false,"text":""},{"type":"text","x":10,"y":91,"w":165,"h":9,"size":10,"html":"見たこと・聞いたこと②（30字まで）"},{"type":"masu","x":10,"y":101,"dir":"h","cell":10,"perLine":10,"lines":3,"leader":true,"autoGrow":false,"text":""},{"type":"text","x":10,"y":136,"w":165,"h":9,"size":10,"html":"見たこと・聞いたこと③（30字まで）"},{"type":"masu","x":10,"y":146,"dir":"h","cell":10,"perLine":10,"lines":3,"leader":true,"autoGrow":false,"text":""},{"type":"text","x":10,"y":182,"w":165,"h":9,"size":10,"html":"働く人のくふうを書きましょう。（30字まで）"},{"type":"masu","x":10,"y":192,"dir":"h","cell":10,"perLine":10,"lines":3,"leader":true,"autoGrow":false,"text":""},{"type":"line","x1":180,"y1":34,"x2":180,"y2":231,"width":0.4,"color":"#8a8f96"},{"type":"text","x":185,"y":34,"w":169,"h":10,"size":12,"html":"分かったことを100字でまとめましょう。"},{"type":"masu","x":185,"y":46,"dir":"v","cell":10,"perLine":10,"lines":10,"gap":0,"leader":true,"autoGrow":false,"text":""},{"type":"text","x":185,"y":151,"w":169,"h":9,"size":10,"html":"絵や図をかきましょう。"},{"type":"rect","x":185,"y":161,"w":169,"h":70,"shape":"round","color":"#8a8f96","width":0.4},{"type":"text","x":10,"y":238,"w":344,"h":8,"size":8,"align":"end","html":"© School Stock"}]}]}},{"key":"seikatsu-2nen-kansatsu","name":"生活 2年　かんさつカード（A4 たて）","subject":"生活","grade":"2年","title":"かんさつカード","note":"生き物や植物の様子を、絵と文で記録する観察カードです。","paper":"A4 たて","pages":1,"doc":{"version":1,"title":"かんさつカード","paper":"A4","orient":"portrait","margin":10,"snap":1,"meta":{"subject":"生活","grade":"2年","name":"かんさつカード","note":"生き物や植物の様子を、絵と文で記録する観察カードです。"},"pages":[{"blocks":[{"type":"text","x":10,"y":10,"w":90,"h":14.5,"size":20,"bold":true,"html":"かんさつカード"},{"type":"text","x":105,"y":11,"w":95,"h":10,"size":12,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":23,"x2":200,"y2":23,"color":"#1b1b1b","width":0.5},{"id":"bxxegc2i","type":"text","x":10,"y":36,"w":190,"h":11.5,"dir":"h","html":"　　月　　日（　　）　　天気（　　　　　）　　気おん（　　　）ど","size":14,"font":"kyokasho","color":"#1b1b1b","bold":false,"align":"start","lineHeight":1.6,"border":"none","fill":"none","pad":1.5},{"type":"text","x":10,"y":58,"w":190,"h":10,"size":12,"html":"見つけたものを　えに　かきましょう。"},{"type":"rect","x":10,"y":73,"w":190,"h":115,"shape":"round","color":"#8a8f96","width":0.5,"dash":"solid","fill":"none"},{"type":"text","x":10,"y":193,"w":190,"h":10,"size":12,"html":"見つけたことを　マス目に　書きましょう。（48字まで）"},{"type":"masu","x":10,"y":208,"dir":"h","cell":12,"perLine":12,"lines":4,"leader":true,"frame":true,"gridColor":"green","text":""},{"type":"text","x":10,"y":277,"w":190,"h":8,"size":8,"align":"end","html":"© School Stock"}]}]}},{"key":"gakkatsu-furikaeri","name":"学級活動 3・4年　ふりかえりカード（B5 たて）","subject":"学級活動","grade":"3・4年","title":"ふりかえりカード","note":"学級活動や道徳の授業後に使う、3段階の自己評価つきふりかえりカードです。","paper":"B5 たて","pages":1,"doc":{"version":1,"title":"ふりかえりカード","paper":"B5","orient":"portrait","margin":10,"snap":1,"meta":{"subject":"学級活動","grade":"3・4年","name":"ふりかえりカード","note":"学級活動や道徳の授業後に使う、3段階の自己評価つきふりかえりカードです。"},"pages":[{"blocks":[{"type":"text","x":10,"y":10,"w":75,"h":13.5,"size":18,"bold":true,"html":"ふりかえりカード"},{"type":"text","x":90,"y":11,"w":82,"h":10,"size":11,"html":"　年　組　名前（　　　　　　　　　　）"},{"type":"line","x1":10,"y1":23,"x2":172,"y2":23,"color":"#1b1b1b","width":0.5},{"type":"text","x":10,"y":28,"w":162,"h":10,"size":12,"html":"今日の学習に、どんな気持ちで取り組めたかな。"},{"type":"text","x":10,"y":51,"w":54,"h":20,"size":30,"align":"center","html":"◎"},{"type":"text","x":64,"y":51,"w":54,"h":20,"size":30,"align":"center","html":"○"},{"type":"text","x":118,"y":51,"w":54,"h":20,"size":30,"align":"center","html":"△"},{"type":"text","x":10,"y":76,"w":54,"h":9.5,"size":11,"align":"center","html":"よくできた"},{"type":"text","x":64,"y":76,"w":54,"h":9.5,"size":11,"align":"center","html":"できた"},{"type":"text","x":118,"y":76,"w":54,"h":9.5,"size":11,"align":"center","html":"もうすこし"},{"type":"text","x":10,"y":99,"w":162,"h":10,"size":12,"html":"きょうの学習で　心にのこったこと（60字まで）"},{"type":"masu","x":10,"y":114,"dir":"h","cell":10,"perLine":15,"lines":4,"leader":true,"frame":true,"gridColor":"green","text":""},{"type":"text","x":10,"y":167,"w":162,"h":10,"size":12,"html":"つぎに　やってみたいこと（40字まで）"},{"type":"masu","x":10,"y":182,"dir":"h","cell":10,"perLine":10,"lines":4,"leader":true,"frame":true,"gridColor":"green","text":""},{"type":"text","x":10,"y":238,"w":162,"h":8,"size":8,"align":"end","html":"© School Stock"}]}]}}];

;
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
    kyokasho: '"UDデジタル教科書体 ProN","UDDigiKyokasho ProN","UD デジタル 教科書体 N-R","UD Digi Kyokasho N-R","UDデジタル教科書体 StdN","游教科書体 New","YuKyokasho","Klee One","Klee One Full","Hiragino Maru Gothic ProN",sans-serif',
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
        text: "", styles: [], fontScale: 0.68, font: "kyokasho", color: "#1b1b1b", autoGrow: true,
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
        if (b.type === "eisen") { b.rowH = r2(b.rowH * k); b.gap = r2(b.gap * k); }
        if (b.type === "text") { b.size = r2(b.size * k); b.pad = r2(b.pad * k); if (b.track) b.track = r2(b.track * k); }
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
    App.fitPage();
    App.renderPanel();
    App.syncHeader();
    // 新しい紙面は、1ページ目のいちばん上から見せる（前の紙面の送った位置を残さない）
    var st = App.$("#stage");
    if (st) { st.scrollTop = 0; st.scrollLeft = 0; }
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
        B[0].rules.danrakuSage = true;   // 作文用紙は、段落の先頭を自動で1マス空ける
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
        B.push(App.make.masu({ x: 140, y: 38, dir: "v", cell: 12, perLine: 12, lines: 5, text: t }));
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

;
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
    if ("guide3" in b) { if (b.guide3 === true) b.guide3 = true; else delete b.guide3; }
    if ("locked" in b) { if (b.locked === true) b.locked = true; else delete b.locked; }
    if ("font" in b) b.font = font(b.font);
    if ("color" in b) b.color = color(b.color, d.color || "#1b1b1b");
    switch (b.type) {
      case "masu":
        b.dir = pick(b.dir, ["v", "h"], "v");
        b.cell = num(b.cell, 10, 3, 60); b.perLine = Math.round(num(b.perLine, 12, 1, 80)); b.lines = Math.round(num(b.lines, 8, 1, 80));
        b.gap = num(b.gap, 0, 0, 40); b.fontScale = num(b.fontScale, 0.68, 0.3, 1);
        // 字の大きさは「小・中・大」の3つ。前の版の値は、いちばん近いものに寄せる（前の「中」0.78 と「大」0.88 は「大」、前の「小」0.64 は「中」）
        b.fontScale = [0.56, 0.68, 0.8].reduce(function (best, v) { return Math.abs(v - b.fontScale) < Math.abs(best - b.fontScale) ? v : best; }, 0.68);
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
        b.track = num(b.track, 0, 0, 60);
        if ("borderColor" in b) b.borderColor = color(b.borderColor, "#1b1b1b");
        if ("round" in b) b.round = b.round === true;
        if ("band" in b) b.band = pick(b.band, ["none", "red", "blue"], "none");
        if ("bandLabel" in b) b.bandLabel = str(b.bandLabel, 12);
        if ("hint" in b) b.hint = str(b.hint, 80);
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
      case "eisen":
        b.w = num(b.w, 180, 20, 400); b.rows = Math.round(num(b.rows, 6, 1, 30)); b.rowH = num(b.rowH, 14, 6, 40); b.gap = num(b.gap, 9, 0, 40);
        b.ratio = pick(b.ratio, ["565", "111"], "565"); b.dash2 = !!b.dash2;
        b.baseColor = color(b.baseColor, "#d8574c"); b.lineColor = color(b.lineColor, "#9b9fa6");
        b.text = str(b.text, 4000);
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
    if ("boardDir" in d) d.boardDir = d.boardDir === "v" ? "v" : "h";
    d.margin = num(d.margin, 10, 0, 40);
    d.snap = num(d.snap, 1, 0.1, 20);
    d.pages = d.pages.slice(0, MAX_PAGES);
    d.pages.forEach(function (pg) {
      pg.blocks = pg.blocks.slice(0, MAX_BLOCKS).map(clean).filter(function (b) { return b.type !== "image" || b.src; });
    });
    return d;
  };
})();

;
/* マス目プリントメーカー：設定のボタンにつけるアイコン
 * 24×24、線の太さ1.6、色は currentColor。定規で描ける記号なので、SVG で描いている。
 * ボタンの名前（日本語）から引く。名前にない物は、字だけのボタンになる。
 */
(function () {
  "use strict";
  var App = window.App, s = App.s;
  var FONT = '"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif';

  function t(txt, x, y, size, weight) {
    var e = s("text", { x: x, y: y, "font-size": size, "font-weight": weight || 600, "font-family": FONT, "text-anchor": "middle", fill: "currentColor", stroke: "none" });
    e.textContent = txt;
    return e;
  }
  function p(d, extra) { return s("path", Object.assign({ d: d }, extra || {})); }
  function fillP(d, op) { return s("path", { d: d, fill: "currentColor", "fill-opacity": op || 0.18, stroke: "currentColor" }); }

  var DEF = {
    // 向き
    "縦書き": function () { return [p("M17 4v15"), p("M14.3 16.3L17 19l2.7-2.7"), p("M11.5 4v11"), p("M6.5 4v8")]; },
    "横書き": function () { return [p("M4 7h15"), p("M16.3 4.3L19 7l-2.7 2.7"), p("M4 12.5h11"), p("M4 17.5h8")]; },
    "縦": function () { return [p("M7 3.5h10v17H7z"), p("M9.5 8h5M9.5 11h5M9.5 14h3")]; },
    "横": function () { return [p("M3.5 7h17v10h-17z"), p("M6.5 10.5h11M6.5 13.5h7")]; },
    // 字の大きさ
    "小": function () { return [t("あ", 12, 17, 10)]; },
    "中": function () { return [t("あ", 12, 18, 14)]; },
    "大": function () { return [t("あ", 12, 19.5, 19)]; },
    // 字のそろえ
    "そろえ:左": function () { return [p("M4 6h16M4 10.5h10M4 15h16M4 19.5h8")]; },
    "そろえ:中央": function () { return [p("M4 6h16M7 10.5h10M4 15h16M8 19.5h8")]; },
    "そろえ:右": function () { return [p("M4 6h16M10 10.5h10M4 15h16M12 19.5h8")]; },
    "そろえ:上": function () { return [p("M6 4v16M10.5 4v10M15 4v16M19.5 4v8")]; },
    "そろえ:下": function () { return [p("M6 4v16M10.5 10v10M15 4v16M19.5 12v8")]; },
    // 字のわきの線
    "なし": function () { return [s("circle", { cx: 12, cy: 12, r: 7.5 }), p("M6.8 17.2L17.2 6.8")]; },
    "一重線": function () { return [t("あ", 9.5, 17, 14), p("M19 4.5v15")]; },
    "二重線": function () { return [t("あ", 9, 17, 14), p("M17.5 4.5v15M20.5 4.5v15")]; },
    "波線": function () { return [t("あ", 9.5, 17, 14), p("M19 4c-2.2 1.3-2.2 2.7 0 4s2.2 2.7 0 4-2.2 2.7 0 4 2.2 2.7 0 4")]; },
    // 字の書式
    "太字": function () { return [t("B", 12, 18.5, 18, 800)]; },
    "下線": function () { return [t("U", 12, 16, 15, 600), p("M6.5 20h11")]; },
    "囲み線": function () { return [p("M4.5 4.5h15v15h-15z"), t("あ", 12, 16.6, 11.5)]; },
    "書式のクリア": function () { return [p("M9 19.5h10.5"), fillP("M4.8 14.2l8.4-8.4 5.3 5.3-8.4 8.4H7.6z", 0.12), p("M9.6 9.4l5.3 5.3")]; },
    // 線の種類
    "実線": function () { return [p("M3.5 12h17")]; },
    "点線": function () { return [p("M3.5 12h17", { "stroke-dasharray": "0.1 3.4" })]; },
    "破線": function () { return [p("M3.5 12h17", { "stroke-dasharray": "4 2.6" })]; },
    // 矢印
    "片方": function () { return [p("M4 12h15"), p("M15 8l4 4-4 4")]; },
    "両方": function () { return [p("M5 12h14"), p("M15.5 8.5L19 12l-3.5 3.5"), p("M8.5 8.5L5 12l3.5 3.5")]; },
    // 形
    "四角形": function () { return [p("M4 6h16v12H4z")]; },
    "角丸四角形": function () { return [s("rect", { x: 4, y: 6, width: 16, height: 12, rx: 4 })]; },
    "楕円": function () { return [s("ellipse", { cx: 12, cy: 12, rx: 8.5, ry: 6.3 })]; },
    // 筆算
    "問題だけ": function () { return [p("M5 4.5h14v15H5z"), p("M8.5 9h7"), t("?", 12, 17.6, 9, 700)]; },
    "答えつき": function () { return [p("M5 4.5h14v15H5z"), p("M8.5 9h7"), p("M8.6 14.4l2.2 2.2 4.6-5", { stroke: "#d12a1e" })]; },
    "方眼": function () { return [p("M4 4h16v16H4z"), p("M4 12h16M12 4v16", { "stroke-dasharray": "1.2 1.8" })]; },
    "マス": function () { return [p("M4 4h16v16H4z"), p("M4 12h16M12 4v16")]; },
    // たたんだわく
    "罫線": function () { return [p("M4 4h16v16H4z", { "stroke-width": 2 }), p("M4 12h16M12 4v16", { "stroke-width": 1.1 }), p("M4 8h16M4 16h16M8 4v16M16 4v16", { "stroke-width": 0.9, "stroke-dasharray": "1 1.6" })]; },
    "原稿用紙設定": function () { return [p("M5 4h14v16H5z"), p("M9.7 4v16M14.3 4v16", { "stroke-width": 1 }), t("」", 16.6, 12.5, 7.5), t("。", 17.6, 18.5, 6.5)]; },
    // 部品
    "前面へ": function () { return [p("M4.5 4.5h10v10h-10z", { "stroke-dasharray": "2 2" }), fillP("M9.5 9.5h10v10h-10z", 0.22)]; },
    "背面へ": function () { return [fillP("M4.5 4.5h10v10h-10z", 0.22), p("M9.5 14.5v5h10v-10h-5", { "stroke-dasharray": "2 2" })]; },
    "複製": function () { return [p("M8.5 8.5h11v11h-11z"), p("M5 15.5V4.5h11")]; },
    "ロック": function () { return [p("M6.5 11h11v8.5h-11z"), p("M8.8 11V8.2a3.2 3.2 0 0 1 6.4 0V11"), p("M12 14.2v2.2")]; },
    "ロック解除": function () { return [p("M6.5 11h11v8.5h-11z"), p("M8.8 11V8.2a3.2 3.2 0 0 1 6.2-1.1"), p("M12 14.2v2.2")]; },
    "削除": function () { return [p("M5 7h14"), p("M10 7V4.8h4V7"), p("M7 7l.9 12.2h8.2L17 7"), p("M10.5 10.5v5.5M13.5 10.5v5.5")]; },
    "画像を入れかえる": function () { return [p("M4 5h16v14H4z"), p("M4 16l4.5-4.5 3.5 3.5 3-3 5 5"), s("circle", { cx: 9, cy: 9.5, r: 1.4 })]; }
  };

  /** ボタンの名前からアイコンを作る。なければ null。 */
  App.uiIcon = function (label, size) {
    var f = DEF[label];
    if (!f) return null;
    var svg = s("svg", { viewBox: "0 0 24 24", width: size || 18, height: size || 18, fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "ui-ic" });
    f().forEach(function (e) { svg.appendChild(e); });
    return svg;
  };
  App.uiIconNames = function () { return Object.keys(DEF); };
})();

;
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

;
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
    // 小さいマス（6mm未満）は、点線を細かく、うすくする（点がつぶれて汚く見えるため）
    if (dots) svg.appendChild(s("path", { d: dots, fill: "none", stroke: col.dot, "stroke-width": c < 6 ? 0.18 : 0.3, "stroke-dasharray": c < 6 ? "0.25 0.55" : "0.6 1.5" }));
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
      ";writing-mode:" + (b.dir === "v" ? "vertical-rl" : "horizontal-tb") +
      // マス目に合わせているとき：1字が1マスぶん進むように字の間をあける（わくの位置を字の間の半分だけずらして、字をマスのまん中に置く）
      (b.track > 0 ? ";letter-spacing:" + b.track + "mm" : "");
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
      var color = cell.role === "answer" ? b.ansColor : (b.color || INK);
      var cx = cell.c * c + c / 2, cy = cell.r * c + c / 2;
      svg.appendChild(s("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": c * (cell.sign ? 0.62 : 0.74), fill: color }, cell.ch));
      if (cell.point) svg.appendChild(s("circle", { cx: cell.c * c + c, cy: cell.r * c + c * 0.8, r: c * 0.06, fill: color }));
      if (cell.strike) svg.appendChild(s("line", { x1: cx + c * 0.26, y1: cy - c * 0.34, x2: cx - c * 0.26, y2: cy + c * 0.34, stroke: color, "stroke-width": 0.35 }));
      if (cell.pointStrike) svg.appendChild(s("line", { x1: cell.c * c + c + c * 0.12, y1: cell.r * c + c * 0.66, x2: cell.c * c + c - c * 0.12, y2: cell.r * c + c * 0.94, stroke: color, "stroke-width": 0.35 }));
    });

    sol.rules.forEach(function (r) {
      if (r.role === "answer" && !showAns) return;
      var color = r.role === "answer" ? b.ansColor : (b.color || INK);
      svg.appendChild(s("line", { x1: r.c0 * c - (r.vinculum ? 0 : c * 0.08), y1: r.r * c, x2: (r.c1 + 1) * c + c * 0.08, y2: r.r * c,
        stroke: color, "stroke-width": 0.5, "stroke-linecap": "round" }));
    });

    if (sol.bracket) {
      var bx = sol.bracket.c * c, top = sol.bracket.r * c, bot = top + c;
      svg.appendChild(s("path", { d: "M" + bx + " " + top + "C" + (bx + c * 0.26) + " " + (top + c * 0.3) + " " + (bx + c * 0.26) + " " + (bot - c * 0.34) + " " + (bx - c * 0.1) + " " + (bot - c * 0.02),
        fill: "none", stroke: b.color || INK, "stroke-width": 0.5, "stroke-linecap": "round" }));
    }
    el.appendChild(svg);
  }

  // ---------- 式 ----------
  function fillShiki(el, b) {
    el.innerHTML = "";
    var box = h("div", { class: "sk" + (b.onBoard ? " on-board" : ""), style: "font-family:" + App.fontCss(b.font) + ";font-size:" + b.size + "pt;color:" + b.color });
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
    var box = h("div", { class: "selbox no-print " + b.type + (App.edit && App.edit.id === b.id ? " editing" : "") + (b.locked ? " locked" : ""), "data-id": b.id });
    var gripName = App.TYPE_NAMES[b.type] + (b.locked ? "（ロック中）" : "");

    if (b.type === "line") {
      box.style.cssText = "left:0;top:0;width:0;height:0;border:0";
      if (!b.locked) [["p1", b.x1, b.y1], ["p2", b.x2, b.y2]].forEach(function (p) {
        box.appendChild(h("div", { class: "h round", "data-h": p[0], style: "left:" + p[1] + "mm;top:" + p[2] + "mm" }));
      });
      var gx = Math.min(b.x1, b.x2), gy = Math.min(b.y1, b.y2);
      box.appendChild(h("div", { class: "grip", style: "left:" + gx + "mm;top:calc(" + gy + "mm - 26px)" }, gripIcon(), gripName));
    } else {
      box.style.cssText = "left:" + r.x + "mm;top:" + r.y + "mm;width:" + r.w + "mm;height:" + r.h + "mm";
      ["n", "s", "e", "w"].forEach(function (k) { box.appendChild(h("div", { class: "edge " + k })); });
      box.appendChild(h("div", { class: "grip" }, gripIcon(), gripName));
      var hs = [];
      if (b.type === "masu" || b.type === "text" || b.type === "rect") hs = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
      else if (b.type === "image") hs = ["nw", "ne", "se", "sw"];
      if (b.locked) hs = [];
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

;
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

  /** マス目の字を、範囲で選んでいるか。 */
  App.masuHasRange = function () {
    var e = App.edit, b = App.selected();
    return !!(b && b.type === "masu" && e && e.type === "masu" && e.id === b.id && e.anchor !== e.focus);
  };

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
    var sx = ev.clientX, sy = ev.clientY, o = JSON.parse(JSON.stringify(b)), moved = false, told = false;
    function mv(m) {
      if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
      if (b.locked) { if (!told) { told = true; App.toast("ロックしています。動かすときは「ロック解除」を押します。", 4000); } return; }
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
      if (moved) {
        if (App.fitToMasu(b)) { App.refreshBlock(b); App.measureAuto(); App.drawSelection(); }
        App.commit(); App.renderPanel();
      }
      else if (!fromGrip && (b.type === "masu" || b.type === "text")) App.startEdit(b, u);
      else if (!fromGrip && b.type === "eisen" && App.startEisenEdit) App.startEisenEdit(b, u);
    }
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  }

  // ---------- 大きさを変える ----------
  function startResize(ev, code) {
    var b = App.selected();
    if (!b || b.locked) return;
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

  // ---------- 筆算を、下にあるマス目に合わせる ----------
  /** 筆算をマス目（ノートのマス）の上に置いたら、そのマス目にぴったり重ねる。
   *  マスの大きさをそろえ、筆算の側の方眼は消す（線が二重にならない）。マス目の外へ出したら、方眼を戻す。
   *  変えたら true。 */
  /** 点（mm）の下にあるマス目と、その点にいちばん近いマスの左上を返す。 */
  function masuCellAt(pageIndex, px, py, selfId) {
    var best = null;
    App.doc.pages[pageIndex].blocks.forEach(function (m) {
      if (m.type !== "masu" || m.id === selfId) return;
      var g = App.bbox(m);
      if (px < g.x || px > g.x + g.w || py < g.y || py > g.y + g.h) return;
      var geo = App.masuGeom(m), c = m.cell, hit = null, dist = 1e9;
      for (var L = 0; L < m.lines; L++) for (var P = 0; P < m.perLine; P++) {
        var xy = geo.xy(L, P), d = Math.abs(g.x + xy[0] + c / 2 - px) + Math.abs(g.y + xy[1] + c / 2 - py);
        if (d < dist) { dist = d; hit = [g.x + xy[0], g.y + xy[1]]; }
      }
      best = { masu: m, x: hit[0], y: hit[1] };
    });
    return best;
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function tellOnce(msg) { if (App.toast && !App.fitToMasu.told) { App.fitToMasu.told = true; App.toast(msg, 5500); } }

  /** テキストボックスを、下のマス目に合わせる。1字が1マスに入る大きさと字の間にして、マスの角に置く。 */
  function fitTextToMasu(b, f) {
    var c0 = b.onMasu && b.cellFit ? b.cellFit : 10;
    var at = b.dir === "v" ? masuCellAt(f.page, b.x + b.w - c0 / 2, b.y + c0 / 2, b.id) : masuCellAt(f.page, b.x + c0 / 2, b.y + c0 / 2, b.id);
    if (!at) {
      if (!b.onMasu) return false;
      b.onMasu = false; b.track = 0; b.pad = 1.5; b.lineHeight = 1.6; delete b.cellFit;
      b.h = Math.max(b.h, App.lineH(b.size, 1));
      return true;
    }
    var m = at.masu, c = m.cell, gap = m.gap || 0, same = b.dir === m.dir, pitch = same ? c + gap : c;
    var before = JSON.stringify([b.x, b.y, b.w, b.h, b.size, b.track, b.lineHeight, b.pad]);
    if (!b.onMasu || b.cellFit !== c) b.size = Math.round(c * 0.68 / 0.3528 * 2) / 2;   // マス目の字の「中」と同じ割合
    var fs = b.size * 0.3528;
    // 行の数は、打ってある文の改行の数から（わくの高さからは数えない）
    var nLines = Math.max(1, (String(b.html || "").match(/<div|<br/gi) || []).length + (/^\s*<div/i.test(b.html || "") ? 0 : 1));
    // いちばん長い行の字数ぶんは、字の進む向きに場所を取る（取らないと、1字ごとに折り返してしまう）
    var longest = String(b.html || "").replace(/<\/div>|<br[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "x").split("\n").reduce(function (n, t) { return Math.max(n, Array.from(t).length); }, 0);
    var mb = App.bbox(m);
    b.track = r2(Math.max(0, c - fs)); b.pad = 0; b.lineHeight = Math.floor(pitch / fs * 100) / 100; b.onMasu = true; b.cellFit = c;
    if (b.dir === "v") {
      b.h = Math.max(c, Math.ceil((b.h - 0.3) / c) * c, Math.min(longest * c, mb.y + mb.h - at.y));
      b.w = nLines * pitch;
      b.x = r2(at.x + c + (same ? gap / 2 : 0) - b.w); b.y = r2(at.y + b.track / 2);
    } else {
      b.w = Math.max(c, Math.ceil((b.w - 0.3) / c) * c, Math.min(longest * c, mb.x + mb.w - at.x));
      b.h = nLines * pitch;
      b.x = r2(at.x + b.track / 2); b.y = r2(at.y - (same ? gap / 2 : 0));
    }
    var changed = before !== JSON.stringify([b.x, b.y, b.w, b.h, b.size, b.track, b.lineHeight, b.pad]);
    // わくの大きさをすぐ画面に入れる（入れないと、前の高さが「中身の高さ」として測られて、もとにもどってしまう）
    var elNow = App.blockEl(b.id);
    if (elNow) App.placeBlock(elNow, b);
    if (changed) tellOnce("テキストを、下のマス目に合わせました（1字が1マスに入ります）。マス目の外へ動かすと、もとにもどります。");
    return changed;
  }
  /** 数式を、下のマス目に合わせる。左はしをマスの線に、高さはマスの行のまん中にそろえる。 */
  function fitShikiToMasu(b, f) {
    var r = App.bbox(b), at = masuCellAt(f.page, r.x + 3, r.y + Math.min(r.h / 2, 8), b.id);
    if (!at) { if (!b.onMasu) return false; b.onMasu = false; return true; }
    var c = at.masu.cell, before = [b.x, b.y, b.size].join();
    if (!b.onMasu || b.cellFit !== c) { b.size = Math.round(c * 0.68 / 0.3528 * 2) / 2; b.cellFit = c; b.onMasu = true; return true; }   // 大きさが変わるので、測りなおしてからもう一度合わせる
    var rows = Math.max(1, Math.ceil((r.h - 0.5) / c));
    b.x = r2(at.x + c * 0.16); b.y = r2(at.y + (rows * c - r.h) / 2);
    if (before !== [b.x, b.y, b.size].join()) { tellOnce("数式を、下のマス目に合わせました。"); return true; }
    return false;
  }

  App.fitToMasu = function (b) {
    if (b && (b.type === "text" || b.type === "shiki")) {
      var ff = App.find(b.id);
      if (!ff) return false;
      if (b.type === "text") return fitTextToMasu(b, ff);
      var ch = fitShikiToMasu(b, ff);
      if (ch && b.onMasu) { App.refreshBlock(b); App.measureAuto(); fitShikiToMasu(b, ff); }   // 字の大きさを変えたあとの高さで、置きなおす
      return ch;
    }
    if (!b || b.type !== "hissan") return false;
    var f = App.find(b.id);
    if (!f) return false;
    var r = App.bbox(b), cx = r.x + Math.min(r.w, b.cell * 1.5), cy = r.y + Math.min(r.h, b.cell * 1.5), hit = null;
    App.doc.pages[f.page].blocks.forEach(function (m) {
      if (m.type !== "masu" || (m.gap || 0) > 0.01) return;
      var g = App.bbox(m);
      if (cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h) hit = m;
    });
    if (!hit) {
      if (!b.onMasu) return false;
      b.onMasu = false; b.grid = "hougan";
      return true;
    }
    var c = hit.cell, g = App.bbox(hit), sol = window.Hissan.solve(b.expr, { zeroStep: b.zeroStep });
    var cols = sol.ok ? sol.cols : 3, rows = sol.ok ? Math.max(sol.rows, sol.reserveRows) + (b.spare || 0) : 3;
    var maxCol = Math.max(0, Math.round(g.w / c) - cols), maxRow = Math.max(0, Math.round(g.h / c) - rows);
    var col = clamp(Math.round((b.x - g.x) / c), 0, maxCol), row = clamp(Math.round((b.y - g.y) / c), 0, maxRow);
    var nx = Math.round((g.x + col * c) * 100) / 100, ny = Math.round((g.y + row * c) * 100) / 100;
    var changed = b.cell !== c || b.grid !== "none" || b.x !== nx || b.y !== ny || !b.onMasu;
    b.cell = c; b.grid = "none"; b.x = nx; b.y = ny; b.onMasu = true;
    if (changed && App.toast && !App.fitToMasu.told) { App.fitToMasu.told = true; App.toast("筆算を、下のマス目に合わせました。マス目の外へ動かすと、もとの方眼にもどります。", 5000); }
    return changed;
  };

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
    // 紙いっぱいのノートのマス目があるときは、そのマス目の中で、ほかの物と重ならないマスを探して置く
    if (!at && (b.type === "hissan" || b.type === "text" || b.type === "shiki")) {
      var note = others.filter(function (o) { if (o.type !== "masu") return false; var r = App.bbox(o); return r.w * r.h > size[0] * size[1] * 0.35; })[0];
      if (note) {
        var nb = App.bbox(note), c = note.cell, things = others.filter(function (o) { return o.type !== "masu"; });
        // 1行目が見出し（1 2 3 …）のノートは、2行目から
        var startRow = note.text && note.dir === "h" ? 1 : 0;
        // まずマス目に合わせて大きさを決めてから、その大きさで空いている場所を探す
        b.x = nb.x; b.y = nb.y + startRow * c;
        if (App.fitToMasu(b)) { App.refreshBlock(b); App.measureAuto(); }
        var rb = App.bbox(b);
        var spot = null, ww = Math.max(rb.w, c), hh = Math.max(rb.h, c);
        for (var ry = startRow; ry * c + hh <= nb.h + 0.5 && !spot; ry++) {
          for (var rx = 0; rx * c + ww <= nb.w + 0.5; rx++) {
            // 縦書きのノートは、右の行から探す
            var tx = note.dir === "v" ? nb.x + nb.w - ww - rx * c : nb.x + rx * c, ty = nb.y + ry * c;
            var clash = things.some(function (o) { var r = App.bbox(o); var mg = r.y + r.h <= nb.y + 1 ? 0 : c * 0.5;   // ノートの外にある名前らんなどは、すき間を取らない
              return tx < r.x + r.w + mg && tx + ww + mg > r.x && ty < r.y + r.h + mg && ty + hh + mg > r.y; });
            if (!clash) { spot = [tx, ty]; break; }
          }
        }
        if (spot) { b.x = spot[0]; b.y = spot[1]; }
      }
    }
    if (App.fitToMasu(b)) { App.refreshBlock(b); App.measureAuto(); }
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

  /** ロック：動かす・大きさを変える・消す、を止める。字を入れることはできる。 */
  App.setLocked = function (id, on) {
    var f = App.find(id);
    if (!f) return;
    if (on) f.block.locked = true; else delete f.block.locked;
    App.drawSelection();
    App.renderPanel();
    App.commit();
    App.toast(on ? "ロックしました。動かなくなります（字は入れられます）。" : "ロックを解除しました。");
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
    delete b.locked;
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
    App.fitMode = null;   // 自分で倍率を変えたら、窓の大きさに合わせるのをやめる
    App.scale = clamp(Math.round(v * 100) / 100, 0.25, 3);
    App.applyScale();
    drawMasuCaret();
  };
  App.fitWidth = function (cap) {
    var avail = App.$("#stage").clientWidth - 64, w = App.pageSize()[0] * App.MM;
    App.setScale(Math.min(cap || 1.6, avail / w));
    App.fitMode = "width";
    App.fitCap = cap || 0;
  };
  /** 1ページ全体が見える倍率にする（既定）。 */
  App.fitPage = function () {
    if (window.__FIT === "width") return App.fitWidth(1);   // 実操作のテスト用（決まった画素数でドラッグするため）
    var st = App.$("#stage"), size = App.pageSize();
    var k = Math.min((st.clientWidth - 64) / (size[0] * App.MM), (st.clientHeight - 76) / (size[1] * App.MM));
    App.setScale(Math.max(0.25, Math.min(1.6, k)));
    App.fitMode = "page";
    st.scrollTop = 0;
  };
  window.addEventListener("resize", function () {
    if (!App.doc) return;
    if (App.fitMode === "page") App.fitPage(); else if (App.fitMode === "width") App.fitWidth(App.fitCap || undefined);
  });

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
      var editingText = App.edit && (App.edit.type === "text" || App.edit.type === "eisen") && blk && blk.dataset.id === App.edit.id;
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
      if (App.tool) return startDraw(ev, page);
      var hEl = ev.target.closest(".h[data-h]");
      if (hEl) return startResize(ev, hEl.dataset.h);
      if (ev.target.closest(".grip") || ev.target.closest(".edge")) {
        var sb = App.selected();
        if (sb) { App.stopEditing(); startMove(ev, sb, true); }
        return;
      }
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
      // ロックしたマス目は動かないので、1回目のドラッグから字を選べるようにする
      if (b.locked && b.type === "masu") { App.startEdit(b, ev); masuPointerDown(ev, b); return; }
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
      if (mod && (key === "s" || key === "S")) { ev.preventDefault(); App.openSaveMenu(); return; }
      if (t.isContentEditable && key === "Escape") { App.stopEditing(); App.renderPanel(); return; }
      if (inIme || inField) return;

      if (key === "Escape") { if (App.tool) App.setTool(null); else App.select(null); return; }
      if (mod && (key === "v" || key === "V") && clipboard) { ev.preventDefault(); pasteBlock(clipboard, App.currentPage()); return; }
      var b = App.selected();
      if (!b) return;
      if (b.locked && (key === "Delete" || key === "Backspace" || /^Arrow/.test(key))) { ev.preventDefault(); App.toast("ロックしています。「ロック解除」を押すと、動かしたり消したりできます。", 4000); return; }
      if (key === "Delete" || key === "Backspace") { ev.preventDefault(); App.removeBlock(b.id); }
      else if (key === "Enter" && (b.type === "masu" || b.type === "text")) { ev.preventDefault(); App.startEdit(b, null); }
      else if (key === "Enter" && b.type === "eisen" && App.startEisenEdit) { ev.preventDefault(); App.startEisenEdit(b, null); }
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

;
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
        text: body, styles: reps > 1 ? styles : [], autoGrow: false,
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
        text: o.headRow || "", autoGrow: false, locked: true });   // ノートのマス目は、はじめからロック（線や筆算を置くときに動かないように）
      if (o.rules) m.rules = Object.assign({}, m.rules, o.rules);
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
    { key: "hougan", name: "5mm方眼ノート（B4）", note: "教科を選ばない方眼の1枚。10mmのマスに、5mmの点線が入ります。B4 横。",
      opts: { title: "5mm方眼ノート", paper: "B4", orient: "landscape", dir: "h", cell: 10, perLine: 33, lines: 22, leader: true, top: 24, kana: false, date: true } },
    { key: "hougan-b5", name: "5mm方眼ノート（B5）", note: "市販の方眼ノートと同じ B5 縦。10mmのマスに、5mmの点線が入ります。よこ16マス、たて23マス。",
      opts: { title: "5mm方眼ノート（B5）", paper: "B5", orient: "portrait", dir: "h", cell: 10, perLine: 16, lines: 23, leader: true, top: 22, kana: false, date: true } },
    { key: "kokugo8", name: "こくご 8マスノート", note: "27mmの大きなマス。たて8マスが6行。B5 縦。",
      opts: { title: "こくご 8マスノート", paper: "B5", orient: "portrait", dir: "v", cell: 26.8, perLine: 8, lines: 6, gap: 0, leader: true, top: 26 } },
    { key: "kokugo10", name: "こくご 10マスノート", note: "21.5mmのマス。たて10マスが7行。市販の学習帳と同じ数です。B5 縦。",
      opts: { title: "こくご 10マスノート", paper: "B5", orient: "portrait", dir: "v", cell: 21.5, perLine: 10, lines: 7, gap: 0, leader: true, top: 28 } },
    { key: "kokugo12", name: "こくご 12マスノート", note: "18mmのマス。たて12マスが8行。市販の学習帳と同じ数です。B5 縦。",
      opts: { title: "こくご 12マスノート", paper: "B5", orient: "portrait", dir: "v", cell: 18, perLine: 12, lines: 8, gap: 0, leader: true, top: 27 } },
    { key: "sansu10", name: "さんすう 10×6マスノート", note: "22mmのマス。よこ10マス。いちばん上に、1から10の見出しがあります。市販の低学年のさんすうと同じ、B5 横です。",
      opts: { title: "さんすう 10×6マスノート", paper: "B5", orient: "landscape", dir: "h", cell: 22, perLine: 10, lines: 7, leader: true, top: 21, headRow: "１２３４５６７８９10" } },
    { key: "sansu12", name: "さんすう 12×7マスノート", note: "19mmのマス。よこ12マス。いちばん上に、1から10と、＋、－の見出しがあります。B5 横です。",
      opts: { title: "さんすう 12×7マスノート", paper: "B5", orient: "landscape", dir: "h", cell: 19, perLine: 12, lines: 8, leader: true, top: 22, headRow: "１２３４５６７８９10＋－" } },
    { key: "sansu15", name: "さんすう 10×14マスノート", note: "15mmのマス。よこ10マス、たて14マス。点線のない、はっきりしたマスです。B5 縦。",
      opts: { title: "さんすう 10×14マスノート", paper: "B5", orient: "portrait", dir: "h", cell: 15, perLine: 10, lines: 14, leader: false, top: 26 } },
    { key: "sansu17", name: "さんすう 17マスノート", note: "12mmのマス。よこ12マス、たて17マス。市販の学習帳と同じ数です。B5 縦。",
      opts: { title: "さんすう 17マスノート", paper: "B5", orient: "portrait", dir: "h", cell: 12, perLine: 12, lines: 17, leader: true, top: 26 } },
    { key: "kokugo", name: "低学年 作文ノート", note: "18mmのマス。たて12マスが7行（84字）。行の右に、ふりがなを書くすきまがあります。B5 縦。",
      opts: { title: "低学年 作文ノート", paper: "B5", orient: "portrait", dir: "v", cell: 18, perLine: 12, lines: 7, gap: 5.8, leader: true, top: 26, rules: { danrakuSage: true } } },
    { key: "jukugo", name: "漢字・熟語 学習プリント", note: "熟語の意味と文を書く表と、18mmの練習マスが1枚になっています。B4 横。",
      build: function () { return App.buildJukugo(); } }
  ];
  /** ノートの紙面を作る。 */
  App.noteDoc = function (s) { return (s.build ? s.build() : App.buildNote(s.opts)).doc; };
})();

;
/* マス目プリントメーカー：板書計画のテンプレート
 * 黒板（緑の面）の上に、めあて、問題、考え、まとめの場所を置いた A4 横の1枚。下に、発問と、子どものノートの形を書く所がある。
 * 黒板の上の字は、白と黄色のチョークの色。部品は、ふつうのテキストボックスと図形なので、自由に動かしたり足したりできる。
 * app-hinagata.js のあとに読みこむ。
 */
(function () {
  "use strict";
  var App = window.App;
  var GREEN = "#2f5d50", FRAME = "#8a6a3b", WHITE = "#ffffff", YELLOW = "#ffe066", PINK = "#ff9e94";

  // 黒板で使う色を、色の一覧に足す
  App.TEXT_COLORS.push(["白（黒板用）", WHITE], ["黄（黒板用）", YELLOW]);
  App.LINE_COLORS.push(["白（黒板用）", WHITE], ["黄（黒板用）", YELLOW]);
  App.FILL_COLORS.push(["黒板の緑", GREEN]);
  App.GRID_COLORS.board = { name: "白（黒板用）", solid: "#dfece6", dot: "#5f8d7d" };

  function T(x, y, w, size, html, extra) {
    return App.make.text(Object.assign({ x: x, y: y, w: w, h: App.lineH(size, 1), size: size, html: html, font: "kyokasho" }, extra || {}));
  }
  function R(x, y, w, hh, extra) { return App.make.rect(Object.assign({ x: x, y: y, w: w, h: hh, width: 0.5 }, extra || {})); }

  /** o = { title, subject: "sansu" | "kokugo" } */
  App.buildBansho = function (o) {
    o = Object.assign({ title: "板書計画", subject: "sansu" }, o || {});
    var B = [], bx = 10, by = 20, bw = 277, bh = 104;
    B.push(T(10, 8, 277, 11, "板書計画　　　月　　日（　　）　　　年　　組　　単元（　　　　　　　　　　　　　　）　本時（　　／　　）"));
    B.push(R(bx, by, bw, bh, { fill: GREEN, color: FRAME, width: 1.6, locked: true }));   // 黒板の面は、はじめからロック
    if (o.subject === "kokugo") {
      // 国語：縦書き。右から、日付と題名、めあて、本文や考え、まとめ
      B.push(App.make.text({ x: bx + bw - 14, y: by + 5, w: 9, h: 40, dir: "v", size: 12, color: WHITE, html: "　月　　日（　）" }));
      B.push(App.make.text({ x: bx + bw - 30, y: by + 5, w: 13, h: 80, dir: "v", size: 18, color: WHITE, bold: true, html: "題名を書く" }));
      B.push(R(bx + bw - 52, by + 5, 17, bh - 10, { color: YELLOW, width: 0.7 }));
      B.push(App.make.text({ x: bx + bw - 50, y: by + 7, w: 13, h: bh - 14, dir: "v", size: 14, color: WHITE, html: "めあて　" }));
      B.push(R(bx + 30, by + 5, bw - 88, bh - 10, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(App.make.text({ x: bx + bw - 70, y: by + 8, w: 9, h: 60, dir: "v", size: 11, color: YELLOW, html: "考えを書く場所" }));
      B.push(R(bx + 5, by + 5, 21, bh - 10, { color: PINK, width: 0.8 }));
      B.push(App.make.text({ x: bx + 8, y: by + 7, w: 15, h: bh - 14, dir: "v", size: 14, color: WHITE, html: "まとめ　" }));
    } else if (o.subject === "rika") {
      // 理科：問題、予想、実験の方法、結果、考察、結論。左から右へ、問題解決の順に進む
      B.push(T(bx + 4, by + 3, 60, 12, "　／　（　）", { color: WHITE }));
      B.push(R(bx + 4, by + 13, 84, 22, { color: YELLOW, width: 0.7 }));
      B.push(T(bx + 6, by + 15, 80, 13, "問題　", { color: WHITE, h: 18 }));
      B.push(T(bx + 4, by + 39, 84, 12, "予想", { color: YELLOW }));
      B.push(R(bx + 4, by + 48, 84, 51, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(T(bx + 94, by + 3, 88, 12, "実験の方法", { color: YELLOW }));
      B.push(R(bx + 94, by + 12, 88, 40, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(T(bx + 96, by + 14, 84, 10, "（図や写真をはる）", { color: "#cfe0d8" }));
      B.push(T(bx + 94, by + 55, 88, 12, "結果", { color: YELLOW }));
      B.push(R(bx + 94, by + 64, 88, 35, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(T(bx + 188, by + 3, 84, 12, "考察", { color: YELLOW }));
      B.push(R(bx + 188, by + 12, 85, 52, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(R(bx + 188, by + 69, 85, 30, { color: PINK, width: 0.8 }));
      B.push(T(bx + 190, by + 71, 81, 13, "結論　", { color: WHITE, h: 26 }));
    } else if (o.subject === "shakai") {
      // 社会：学習問題、資料（まん中）、気づいたこと、考えたこと、まとめ
      B.push(T(bx + 4, by + 3, 60, 12, "　／　（　）", { color: WHITE }));
      B.push(R(bx + 4, by + 13, bw - 8, 16, { color: YELLOW, width: 0.7 }));
      B.push(T(bx + 6, by + 15, bw - 12, 13, "学習問題　", { color: WHITE, h: 12 }));
      B.push(T(bx + 4, by + 32, 80, 12, "気づいたこと", { color: YELLOW }));
      B.push(R(bx + 4, by + 41, 80, 34, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(R(bx + 90, by + 33, 97, 42, { color: WHITE, width: 0.6 }));
      B.push(T(bx + 92, by + 35, 93, 10, "資料（地図、グラフ、写真をはる）", { color: "#cfe0d8" }));
      B.push(T(bx + 193, by + 32, 80, 12, "考えたこと", { color: YELLOW }));
      B.push(R(bx + 193, by + 41, 80, 34, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(R(bx + 4, by + 79, bw - 8, 20, { color: PINK, width: 0.8 }));
      B.push(T(bx + 6, by + 81, bw - 12, 13, "まとめ　", { color: WHITE, h: 16 }));
    } else {
      // 算数：横書き。左に、日付、めあて、問題。右に、考えを2つ。下に、まとめ
      B.push(T(bx + 4, by + 3, 60, 12, "　／　（　）", { color: WHITE }));
      B.push(R(bx + 4, by + 13, 124, 17, { color: YELLOW, width: 0.7 }));
      B.push(T(bx + 6, by + 15, 120, 14, "めあて　", { color: WHITE, h: 13 }));
      B.push(T(bx + 4, by + 34, 124, 13, "問題　", { color: WHITE, h: 36 }));
      B.push(R(bx + 134, by + 5, 68, 64, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(T(bx + 136, by + 6, 64, 11, "考え①", { color: YELLOW }));
      B.push(R(bx + 205, by + 5, 68, 64, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(T(bx + 207, by + 6, 64, 11, "考え②", { color: YELLOW }));
      B.push(R(bx + 4, by + 74, bw - 8, 25, { color: PINK, width: 0.8 }));
      B.push(T(bx + 6, by + 76, bw - 12, 14, "まとめ　", { color: WHITE, h: 21 }));
    }
    // 黒板の下：発問と、子どものノートの形
    B.push(T(10, 128, 120, 11, "主な発問・指示", { bold: true }));
    B.push(R(10, 137, 135, 63, { width: 0.4 }));
    B.push(T(12, 139, 131, 11, "", { h: 59 }));
    B.push(T(152, 128, 135, 11, "子どものノート（この形で書かせる）", { bold: true }));
    B.push(App.make.masu({ x: 152, y: 137, dir: o.subject === "kokugo" ? "v" : "h", cell: 7, perLine: o.subject === "kokugo" ? 9 : 19, lines: o.subject === "kokugo" ? 19 : 9, leader: true, text: "", autoGrow: false }));
    return { doc: { version: 1, title: o.title, paper: "A4", orient: "landscape", margin: 10, snap: 1, pages: [{ blocks: B }] } };
  };

  /** ノートと同じマスの数で書く板書。黒板の上のマス目の1マスが、子どものノートの1マス。見開きの2ページぶん。
   *  o = { title, subject: "sansu" | "kokugo" } */
  App.buildBanshoNote = function (o) {
    var B = [], bx = 10, by = 20, bw = 277, bh = 104, kokugo = o.subject === "kokugo", hougan = o.subject === "hougan";
    B.push(T(10, 8, 277, 11, "板書計画　　　月　　日（　　）　　　年　　組　　単元（　　　　　　　　　　　　　　）　本時（　　／　　）"));
    B.push(R(bx, by, bw, bh, { fill: GREEN, color: FRAME, width: 1.6, locked: true }));
    function page(x, y, label) {
      var m = kokugo
        ? App.make.masu({ x: x, y: y, dir: "v", cell: 7, perLine: 12, lines: 8, gap: 0, leader: false, gridColor: "board", color: WHITE, text: "", autoGrow: false, locked: true })
        : App.make.masu({ x: x, y: y, dir: "h", cell: hougan ? 4 : 5.5, perLine: hougan ? 16 : 12, lines: hougan ? 23 : 17, gap: 0, leader: hougan, gridColor: "board", color: WHITE, text: "", autoGrow: false, locked: true });
      B.push(m);
      return m;
    }
    if (kokugo) {
      // 縦書きのノートは、右のページから始まる
      B.push(T(bx + bw - 62, by + 3, 56, 9, "ノート 右のページ（12マス×8行）", { color: YELLOW, align: "end" }));
      page(bx + bw - 6 - 56, by + 12);
      B.push(T(bx + bw - 124, by + 3, 56, 9, "左のページ", { color: YELLOW, align: "end" }));
      page(bx + bw - 12 - 112, by + 12);
      B.push(R(bx + 5, by + 12, 140, 84, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(T(bx + 7, by + 3, 136, 9, "ノートに書かせないもの（本文の拡大、さし絵、子どもの考えの短冊）", { color: YELLOW }));
    } else {
      // 5mm方眼は、1マス4mm（よこ16×たて23）。さんすう17マスは、1マス5.5mm（よこ12×たて17）
      var pw = hougan ? 64 : 66, top = hougan ? 9.5 : 8.5, x2 = bx + 6 + pw + 6, x3 = x2 + pw + 6;
      B.push(T(bx + 6, by + 1, pw + 4, 9, hougan ? "ノート 左のページ（よこ16×たて23）" : "ノート 左のページ（よこ12×たて17）", { color: YELLOW }));
      page(bx + 6, by + top);
      B.push(T(x2, by + 1, pw, 9, "右のページ", { color: YELLOW }));
      page(x2, by + top);
      B.push(R(x3, by + top, bx + bw - 5 - x3, bh - top - 2, { color: WHITE, width: 0.4, dash: "dash" }));
      B.push(T(x3 + 2, by + 1, bx + bw - 7 - x3, 9, "ノートに書かせないもの（図、掲示物、子どもの考え）", { color: YELLOW }));
    }
    B.push(T(10, 128, 277, 11, "主な発問・指示", { bold: true }));
    B.push(R(10, 137, 277, 63, { width: 0.4 }));
    B.push(T(12, 139, 273, 11, "", { h: 59 }));
    return { doc: { version: 1, title: o.title, paper: "A4", orient: "landscape", margin: 10, snap: 0.5, pages: [{ blocks: B }] } };
  };

  // ---------- 黒板の上に置いたものは、チョークの色にする ----------
  /** 部品のまん中が、黒板の面（緑でぬった四角）の上にあるか。 */
  function onBoard(b, pageIndex) {
    var g = App.bbox(b), cx = g.x + g.w / 2, cy = g.y + g.h / 2;
    return App.doc.pages[pageIndex].blocks.some(function (r) {
      return r !== b && r.type === "rect" && r.fill === GREEN && cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h;
    });
  }
  var INK = "#1b1b1b", RED = "#d12a1e";
  function chalk(b) {
    var f = App.find(b.id);
    if (!f || ["text", "hissan", "shiki", "line", "rect"].indexOf(b.type) < 0 || (b.type === "rect" && b.fill === GREEN)) return false;
    var on = onBoard(b, f.page);
    if (on && !b.onBoard) {
      b.onBoard = true;
      if (!b.color || b.color === INK) { if (!(b.type === "text" && b.fill && b.fill !== "none")) b.color = WHITE; }
      if (b.type === "text" && (!b.borderColor || b.borderColor === INK) && !(b.fill && b.fill !== "none")) b.borderColor = WHITE;
      if (b.type === "hissan") { if (b.ansColor === RED) b.ansColor = YELLOW; if (!b.onMasu) b.grid = "none"; }
      return true;
    }
    if (!on && b.onBoard) {
      delete b.onBoard;
      if (b.color === WHITE) b.color = INK;
      if (b.type === "hissan") { if (b.ansColor === YELLOW) b.ansColor = RED; if (!b.onMasu && b.grid === "none") b.grid = "hougan"; }
      return true;
    }
    return false;
  }
  // 置いたときと、動かし終わったときに呼ばれる所（マス目に合わせる処理）に相乗りする
  var fit0 = App.fitToMasu;
  App.fitToMasu = function (b) {
    var a = fit0.apply(App, arguments), c = chalk(b);
    if (c && !a) { App.refreshBlock(b); if (App.toast && !chalk.told) { chalk.told = true; App.toast("黒板の上なので、チョークの色（白）にしました。色は「フォントの色」で変えられます。", 5000); } }
    return a || c;
  };
  App.fitToMasu.told = fit0.told;

  // =====================================================================
  // 板書の部品（実物の板書の調べから。docs/板書の調べ_2026-09-21.md）
  //   実物の板書は「見出しのついた箱」ではなく、めあての棒、問題番号、囲み、吹き出し、矢印、貼る紙でできている。
  //   どれも、ふつうのテキスト ボックスに、かざりの設定を足したもの。動かす、字を打つ、消す、はテキスト ボックスと同じ。
  // =====================================================================
  var BAND = { red: "#e0483e", blue: "#3b82d6" };

  var fillB0 = App.fillBlock;
  App.fillBlock = function (el, b) {
    fillB0(el, b);
    if (b.type !== "text") return;
    var tx = el.querySelector(".tx"), old = el.querySelector(".band-tag");
    if (old) old.remove();
    if (!tx) return;
    if (b.borderColor && b.border && b.border !== "none") tx.style.borderColor = b.borderColor;
    if (b.round) tx.style.borderRadius = "3.2mm";
    if (b.band && BAND[b.band]) {
      var bar = "1.5mm solid " + BAND[b.band];
      if (b.dir === "v") { tx.style.borderLeft = bar; tx.style.borderRight = bar; } else { tx.style.borderTop = bar; tx.style.borderBottom = bar; }
      if (b.bandLabel) el.appendChild(App.h("span", { class: "band-tag " + b.dir, style: "color:" + BAND[b.band] }, b.bandLabel));
    }
  };

  /** テキスト ボックスの設定に、板書のかざりを足す。 */
  App.textPanelExtra = function (p, b, ui) {
    if (!hasBoard()) return;
    p.appendChild(ui.group("板書",
      ui.row("棒ではさむ", ui.seg([["none", "なし"], ["red", "赤（めあて）"], ["blue", "青（まとめ）"]], b.band || "none", function (v) {
        b.band = v; b.bandLabel = v === "red" ? "めあて" : v === "blue" ? "まとめ" : ""; ui.touch(b);
      })),
      ui.row("枠線の色", ui.swatches([["白", WHITE], ["黄", YELLOW], ["ピンク", PINK], ["黒", "#1b1b1b"]], b.borderColor || "#1b1b1b", function (v) { b.borderColor = v; if (!b.border || b.border === "none") b.border = "solid"; ui.touch(b); })),
      ui.check("角を丸くする（吹き出し）", !!b.round, function (v) { b.round = v; ui.touch(b); })));
  };

  function boardRect(pi) {
    var page = App.doc && App.doc.pages[pi == null ? App.currentPage() : pi];
    return page ? page.blocks.filter(function (r) { return r.type === "rect" && r.fill === GREEN; })[0] : null;
  }
  function hasBoard() { return !!(App.doc && App.doc.pages.some(function (pg, i) { return boardRect(i); })); }

  // 部品の一覧。opts は、テキスト ボックスの設定
  var BODY = 16;   // 黒板の上の字。実物の黒板（よこ3.6m）を紙のよこ277mmに写すと、16pt の字は実物で約7cm。4年の目安（8〜10cm）に近い
  var PARTS = [
    { key: "meate", name: "めあて", note: "赤い棒2本ではさむ", o: { w: 86, h: 17, size: BODY, band: "red", bandLabel: "めあて", pad: 2, html: "" } },
    { key: "matome", name: "まとめ", note: "青い棒2本ではさむ", o: { w: 86, h: 24, size: BODY, band: "blue", bandLabel: "まとめ", pad: 2, html: "" } },
    { key: "bango", name: "問題番号", note: "四角で囲んだ 1、2、3", o: { w: 8.5, h: 8.5, size: BODY, border: "solid", borderColor: WHITE, align: "center", pad: 0, lineHeight: 1.3, html: "1" } },
    { key: "moji", name: "黒板の字", note: "白いチョーク", o: { w: 80, h: 8, size: BODY, pad: 0.5, html: "" } },
    { key: "kiiro", name: "黄色の字", note: "大事な言葉", o: { w: 50, h: 8, size: BODY, color: YELLOW, pad: 0.5, html: "" } },
    { key: "kakomi", name: "黄色の囲み", note: "式、公式、きまり", o: { w: 78, h: 10, size: BODY, border: "solid", borderColor: YELLOW, pad: 1.5, align: "center", html: "" } },
    { key: "fukidashi", name: "吹き出し", note: "予想される子どもの言葉", o: { w: 60, h: 14, size: 13, border: "solid", borderColor: WHITE, round: true, pad: 2, lineHeight: 1.4, html: "" } },
    { key: "tanzaku", name: "貼る紙（短冊）", note: "発問、子どもの考え、資料の札", o: { w: 60, h: 10, size: 14, fill: "#ffffff", color: "#1b1b1b", border: "solid", borderColor: "#1b1b1b", pad: 1.5, html: "" } },
    { key: "hizuke", name: "日付とページ", note: "左はしに縦書きで", o: { w: 7, h: 40, dir: "v", size: 10, pad: 0.5, lineHeight: 1.2, html: "9／2（火）p.○〜○" } }
  ];
  App.BANSHO_PARTS = PARTS;
  var partCount = 0;
  App.addBanshoPart = function (key) {
    var part = PARTS.filter(function (x) { return x.key === key; })[0], bd = boardRect();
    if (!part || !bd) return;
    var o = Object.assign({ color: WHITE, font: "kyokasho" }, part.o), k = partCount++ % 6;
    // 縦書きの黒板（縦書きの字の方が多い）では、部品も縦書きで、たてよこを入れかえて出す
    var onB = App.doc.pages[App.currentPage()].blocks.filter(function (x) { return x.onBoard && x.type === "text"; });
    // 黒板の向きは、紙に書いてあればそれ（boardDir）。なければ、黒板の上の字の向きで決める（左はしの細い日付は数えない）
    var body = onB.filter(function (x) { return x.w > 9 || x.dir !== "v"; });
    var vertical = App.doc.boardDir ? App.doc.boardDir === "v" : (body.length > 0 && body.filter(function (x) { return x.dir === "v"; }).length > body.length / 2);
    if (vertical && part.key !== "hizuke") { o.dir = "v"; var tmp = o.w; o.w = Math.max(o.h, 9); o.h = Math.min(tmp, bd.h - 8); }
    // 黒板の上で、ほかの部品と重ならない場所を、左上から順に探して置く。なければ、まん中あたりに少しずつずらして置く
    var others = App.doc.pages[App.currentPage()].blocks.filter(function (x) { return x !== bd && !x.guide3; }).map(function (x) {
      var r = App.bbox(x);   // 線のわくは、つかみやすいように太らせてある。置き場所さがしでは、線そのものの太さで見る
      return x.type === "line" ? { x: r.x + 2.5, y: r.y + 2.5, w: Math.max(0.5, r.w - 5), h: Math.max(0.5, r.h - 5) } : r;
    }), spot = null;
    // 縦書きの黒板は右から、横書きは左から。棒ではさむ部品は、札のぶん（縦書きは右に7mm、横書きは上に3mm）を空ける
    var tagR = vertical && o.band ? 7 : 0, tagT = !vertical && o.band ? 3 : 0;
    function free(xx, yy) {
      return !others.some(function (r) { return xx < r.x + r.w + 2 && xx + o.w + 2 + tagR > r.x && yy - tagT < r.y + r.h + 2 && yy + o.h + 2 > r.y; });
    }
    var xs = [], x0 = bd.x + 12, x1 = bd.x + bd.w - 3 - o.w - tagR;
    // まず、3つの場所それぞれの左はしをためす（3分割の線をまたがないように）。それから、4mmきざみで探す
    var zw = bd.w / 3;
    o.w = Math.min(o.w, zw - 17);
    [bd.x + 13.5, bd.x + zw + 3, bd.x + zw * 2 + 3].forEach(function (zx) { if (zx + o.w <= bd.x + bd.w - 3) xs.push(zx); });
    for (var xx = x0; xx <= x1; xx += 4) xs.push(xx);
    if (vertical) { xs = []; for (xx = bd.x + bd.w - 12 - o.w - tagR; xx >= bd.x + 4; xx -= 4) xs.push(xx); }
    for (var i = 0; i < xs.length && !spot; i++) {
      for (var yy = bd.y + 4 + tagT; yy + o.h <= bd.y + bd.h - 3; yy += 3.8) {
        if (free(xs[i], yy)) { spot = [xs[i], yy]; break; }
      }
    }
    o.at = spot ? { page: App.currentPage(), x: spot[0] + o.w / 2, y: spot[1] + o.h / 2 }
      : { page: App.currentPage(), x: bd.x + bd.w / 2 - 20 + k * 7, y: bd.y + bd.h / 2 - 10 + k * 5 };
    o.onBoard = true;
    App.addBlock("text", o);
  };

  // 左の道具の列に「板書の部品」を足す（黒板のある紙のときだけ出る）
  function closeParts() { var m = document.getElementById("parts-menu"); if (m) m.remove(); }
  function openParts(btn) {
    if (document.getElementById("parts-menu")) return closeParts();
    var r = btn.getBoundingClientRect();
    var menu = App.h("div", { id: "parts-menu", class: "save-menu parts-menu", role: "menu" });
    if (App.toggleGuide3) {
      var has3 = App.doc.pages[App.currentPage()].blocks.some(function (b) { return b.guide3; });
      menu.appendChild(App.h("button", { type: "button", "data-part": "guide3", onclick: function () { closeParts(); App.toggleGuide3(); } }, App.h("b", null, has3 ? "3分割の線を消す" : "3分割の線を出す"), App.h("small", null, "黒板を3つに分ける、うすい点線")));
      menu.appendChild(App.h("hr"));
    }
    PARTS.forEach(function (x) {
      menu.appendChild(App.h("button", { type: "button", "data-part": x.key, onclick: function () { closeParts(); App.addBanshoPart(x.key); } }, App.h("b", null, x.name), App.h("small", null, x.note)));
    });
    menu.style.left = (r.right + 8) + "px";
    menu.style.top = Math.max(60, Math.min(r.top - 120, window.innerHeight - 470)) + "px";
    document.body.appendChild(menu);
  }
  document.addEventListener("pointerdown", function (ev) {
    if (document.getElementById("parts-menu") && !(ev.target.closest && ev.target.closest("#parts-menu, #btn-parts"))) closeParts();
  }, true);
  function syncPartsButton() {
    var box = document.querySelector(".tools");
    if (!box) return;
    var btn = document.getElementById("btn-parts");
    if (!btn) {
      btn = App.h("button", { type: "button", id: "btn-parts", title: "めあて、まとめ、問題番号、吹き出しなど、板書の部品を置く", onclick: function () { openParts(btn); } });
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5h18v11H3z"/><path d="M6.5 9h7M6.5 12h4.5"/><path d="M7 19.5h10"/></svg><span>板書</span>';
      box.insertBefore(btn, box.firstChild);
    }
    btn.style.display = hasBoard() ? "" : "none";
  }
  var render0 = App.renderAll;
  App.renderAll = function () { var r = render0.apply(App, arguments); syncPartsButton(); return r; };

  // ---------- 見本：中身の入った板書計画（算数） ----------
  /** 実物の黒板と同じ、よこ長の比（約3.6対1）。黒板の下に、発問と、予想される反応を、黒板の3つの場所にそろえて書く。 */
  App.buildBanshoSample = function () {
    var B = [], bx = 10, by = 18, bw = 277, bh = 78, z = bw / 3;
    function C(x, y, w, html, extra) { return App.make.text(Object.assign({ x: x, y: y, w: w, h: 8, size: BODY, color: WHITE, pad: 0.5, lineHeight: 1.35, html: html, font: "kyokasho", onBoard: true }, extra || {})); }
    B.push(T(10, 7, 277, 11, "板書計画　　4年　算数　「2けたでわるわり算」　本時 1／12　　ねらい：何十でわる計算のしかたを、10をもとにして考える。"));
    B.push(R(bx, by, bw, bh, { fill: GREEN, color: FRAME, width: 1.6, locked: true }));
    // 左はし：日付とページ、区切りの線
    B.push(C(bx + 1.5, by + 3, 6.5, "9／2（火）p.○", { dir: "v", size: 9, h: 40, lineHeight: 1.2 }));
    B.push(App.make.line({ x1: bx + 9.5, y1: by + 3, x2: bx + 9.5, y2: by + bh - 3, color: WHITE, width: 0.4 }));
    // 字は 16pt。1つの場所（黒板の3分の1）に入るのは、1行13〜15字、10行まで。実物の板書の調べ（1行11〜18字、5〜9行）と合う
    var P = 7.6;   // 1行の送り
    function row(n) { return by + 3 + P * n; }
    // 左：はじめの問題（前の学年までの計算でできる）
    B.push(C(bx + 12, row(0), z - 14, "90円でガムを買います。<br>1こ9円だと何こ買える？", { h: P * 2 }));
    B.push(C(bx + 17, row(2), z - 20, "90÷9＝10　答え10こ"));
    B.push(C(bx + 12, row(4), z - 14, "1こ30円のガムだと？"));
    B.push(C(bx + 17, row(5), 34, "90÷30＝"));
    B.push(C(bx + 50, row(5), 10, "？", { color: YELLOW }));
    B.push(C(bx + 14, row(7), 60, "9÷3と同じになりそう", { h: 11, size: 13, border: "solid", borderColor: WHITE, round: true, pad: 2, align: "center" }));
    // 中：問題番号、めあて、考え
    var cx = bx + z + 2;
    B.push(C(cx, row(0), 8.5, "1", { h: 8.5, border: "solid", borderColor: WHITE, align: "center", pad: 0, lineHeight: 1.3 }));
    B.push(C(cx + 10, row(0), z - 16, "90÷30の計算のしかたを<br>考えましょう。", { h: P * 2 }));
    B.push(C(cx, row(2) + 3, z - 6, "⑩をつかって、90÷30の<br>計算のしかたを考えよう。", { h: 19, band: "red", bandLabel: "めあて", pad: 1.6 }));
    B.push(C(cx, row(5) + 2.5, z - 6, "10円玉の9こと3こをくらべる"));
    B.push(C(cx + 5, row(6) + 2.5, z - 12, "⑩が（9÷3）こ → 3こ", { color: YELLOW }));
    B.push(C(cx + 2, row(8), z - 12, "たしかめ　3×30＝90", { h: 10.5, border: "solid", borderColor: YELLOW, pad: 1.4, align: "center" }));
    // 右：たしかめの問題、まとめ
    var rx = bx + z * 2 + 2;
    B.push(C(rx, row(0), 8.5, "2", { h: 8.5, border: "solid", borderColor: WHITE, align: "center", pad: 0, lineHeight: 1.3 }));
    B.push(C(rx + 10, row(0), z - 16, "150円で、1こ30円の<br>ガムは何こ買えますか。", { h: P * 2 }));
    B.push(C(rx + 5, row(2), z - 12, "⑩が15こ　15÷3＝5"));
    B.push(C(rx + 5, row(3), z - 12, "150÷30＝5　答え5こ"));
    B.push(C(rx, row(5), z - 8, "⑩の何こ分かと考えると、<br>わる数が2けたでも、<br>商の見当をつけられる。", { h: 27, band: "blue", bandLabel: "まとめ", pad: 1.6 }));
    B.push(App.make.line({ x1: bx + 62, y1: row(5) + 2, x2: cx - 1.5, y2: row(3) + 4, color: YELLOW, width: 0.5, arrow: "end" }));
    // 黒板の下：3つの場所にそろえて、発問と予想される反応
    var ty = by + bh + 6, th = 210 - 10 - ty - 7;
    ["はじめ（10分）", "考える（25分）", "まとめる（10分）"].forEach(function (t, i) {
      B.push(T(bx + z * i + (i ? 2 : 0), ty, z - 4, 10.5, t + "　発問と、予想される反応", { bold: true }));
      B.push(R(bx + z * i + (i ? 2 : 0), ty + 7, z - 4, th, { width: 0.4 }));
    });
    var notes = [
      "①「1こ9円なら、何こ買える？」<br>　→ 90÷9＝10（3年の計算でできる）<br>②「30円のガムなら？ 式は？」<br>　→ 90÷30。わる数が2けたは初めて<br>　→「9÷3と同じになりそう」を吹き出しで残す",
      "③「10円玉で考えると、90円は何こ？ 30円は？」<br>　→ 9こと3こ。9÷3＝3<br>④「3で本当に正しい？ どうやって確かめる？」<br>　→ 3×30＝90（たしかめの式を黄色で囲む）<br>・手が止まる子には、10円玉の図をかかせる",
      "⑤ 2番を自分で解く。「⑩が何こ？」<br>　→ 15こ。15÷3＝5<br>⑥「今日分かったことを、自分の言葉で」<br>　→ 子どもの言葉をつないで、まとめにする<br>・めあてと、まとめがつながっているかを見る"
    ];
    notes.forEach(function (n, i) { B.push(T(bx + z * i + (i ? 2 : 0) + 1.5, ty + 8.5, z - 7, 10, n, { h: th - 3, lineHeight: 1.55 })); });
    return { doc: { version: 1, title: "板書計画（算数・見本）", paper: "A4", orient: "landscape", margin: 8, snap: 0.5, pages: [{ blocks: B }] } };
  };

  // 教科ごとの型は app-bansho-kata.js と app-bansho-data*.js に移した（2026-09-21。前の「見出しだけの箱」の4つの型は外した）。
  // ここに残すのは、黒板の上にノートと同じ数のマス目を置いた3つ。
  App.BANSHO_SHEETS = [
    { key: "bansho-note-sansu", name: "さんすう17マスノートと同じマス", note: "黒板の上のマス目が、ノートの見開き（よこ12×たて17が2ページ）と同じ数。1マスに1字で板書を考えます。", build: function () { return App.buildBanshoNote({ title: "板書計画（算数・ノートと同じマス）", subject: "sansu" }); } },
    { key: "bansho-note-hougan", name: "5mm方眼ノートと同じマス", note: "5mm方眼ノート（B5）の見開きと同じ、よこ16×たて23が2ページ。10mmのマスに5mmの点線。", build: function () { return App.buildBanshoNote({ title: "板書計画（5mm方眼ノートと同じマス）", subject: "hougan" }); } },
    { key: "bansho-note-kokugo", name: "こくご12マスノートと同じマス", note: "こくご12マスノートの見開き（12マス×8行が2ページ）と同じ数。縦書き。", build: function () { return App.buildBanshoNote({ title: "板書計画（国語・ノートと同じマス）", subject: "kokugo" }); } }
  ];

})();

;
/* マス目プリントメーカー：板書計画の型と記入例
 * もとにしたもの：docs/板書の調べ_2026-09-21.md（板書ギャラリーと本人の板書、教科ごとの調べ）
 * 1つの型は、部品の置き方を書いた表（KATA）。同じ表から、字の入っていない「型」と、字の入った「記入例」の両方を作る。
 *   型　　：部品は置いてあり、うすい字で「ここに何を書くか」が出る。クリックして打つ。
 *   記入例：4年生の学習を例に、中身を書きこんだもの。打ちかえて使ってもよい。
 * app-bansho.js のあとに読みこむ。
 */
(function () {
  "use strict";
  var App = window.App;
  var GREEN = "#2f5d50", FRAME = "#8a6a3b", WHITE = "#ffffff", YELLOW = "#ffe066", PINK = "#ff9e94", GUIDE = "#86aa9c", INK = "#1b1b1b";
  var BX = 10, BY = 18, BW = 277, BH = 78, Z = BW / 3, P = 7.6, BODY = 16;

  // 部品の種類ごとの、テキスト ボックスの設定
  var KIND = {
    moji: {},
    kiiro: { color: YELLOW },
    pink: { color: PINK },
    midashi: { color: YELLOW, size: 13 },
    meate: { band: "red", bandLabel: "めあて", pad: 1.6 },
    matome: { band: "blue", bandLabel: "まとめ", pad: 1.6 },
    furikaeri: { border: "dotted", borderColor: WHITE, pad: 1.4, size: 13 },
    bango: { border: "solid", borderColor: WHITE, align: "center", pad: 0, lineHeight: 1.3 },
    kakomi: { border: "solid", borderColor: YELLOW, pad: 1.4, align: "center" },
    waku: { border: "solid", borderColor: WHITE, pad: 1.4 },
    fuki: { border: "solid", borderColor: WHITE, round: true, pad: 1.8, size: 13, lineHeight: 1.4 },
    tanzaku: { fill: "#ffffff", color: INK, border: "solid", borderColor: INK, pad: 1.4, size: 13 },
    wb: { fill: "#ffffff", color: INK, border: "bold", borderColor: "#9aa0a6", pad: 1.2, size: 9, lineHeight: 1.4 },
    shiryo: { fill: "#f0f0ee", color: "#555b62", border: "solid", borderColor: "#9aa0a6", pad: 1.4, size: 10, align: "center" }
  };

  /** 表の1行を、部品にする。
   *  横書き：{ k, z: 0〜2（3分割のどこか）か省く, x, r（行。0〜9）, y（mm。r のかわり）, w, rows（高さを行数で）, h, t（記入例の字）, hint（型のうすい字） }
   *  縦書き：{ k, c（右から何列めか）, cols（列の数）, top, len }  */
  function item(it, example, vertical) {
    var o = Object.assign({ size: BODY, color: WHITE, pad: 0.5, lineHeight: 1.35, font: "kyokasho", onBoard: true }, KIND[it.k] || {}, it.o || {});
    var x, y, w, hh;
    if (vertical) {
      o.dir = (it.o && it.o.dir) || "v";
      w = (it.cols || 1) * P;
      x = BX + BW - 4 - (it.c || 0) * P - w + (it.dx || 0);
      y = BY + (it.top == null ? 4 : it.top);
      hh = it.len || BH - 8;
    } else {
      var zx = it.z == null ? BX : BX + Z * it.z + (it.z === 0 ? 11 : 2.5);
      x = zx + (it.x || 0);
      y = it.y != null ? BY + it.y : BY + 3 + P * (it.r || 0);
      w = it.w || (it.z == null ? 60 : Z - (it.z === 0 ? 14 : 6) - (it.x || 0));
      hh = it.h || P * (it.rows || 1) + (o.pad > 1 ? 2.5 : 0);
    }
    return App.make.text(Object.assign(o, { x: x, y: y, w: w, h: hh, html: example ? (it.t || "") : (it.keep ? it.t || "" : ""), hint: example ? "" : (it.hint || "") }));
  }

  function T(x, y, w, size, html, extra) {
    return App.make.text(Object.assign({ x: x, y: y, w: w, h: App.lineH(size, 1), size: size, html: html, font: "kyokasho" }, extra || {}));
  }
  function R(x, y, w, hh, extra) { return App.make.rect(Object.assign({ x: x, y: y, w: w, h: hh, width: 0.5 }, extra || {})); }

  /** 型の表から、紙を作る。example が true なら記入例。 */
  App.buildKata = function (K, example) {
    var B = [], vertical = K.dir === "v";
    // 上の1行。長いときは、1行におさまる大きさまで字を小さくする
    var headText = example && K.head ? K.head : "板書計画　　　年　　組　　教科（　　　）　単元（　　　　　　　　　　　　）　本時　　／　　　ねらい：";
    var headSize = Math.max(8, Math.min(11, Math.floor(270 / headText.length / 0.3528 * 10) / 10));
    B.push(T(10, headSize < 10 ? 8.5 : 7, 277, headSize, headText));
    B.push(R(BX, BY, BW, BH, { fill: GREEN, color: FRAME, width: 1.6, locked: true }));
    if (!vertical) {
      // 左はしの日付とページ、区切りの線
      B.push(item({ k: "moji", y: 3, x: 1.5, w: 6.5, h: 46, t: "○／○（○）Ｐ○", keep: true, o: { dir: "v", size: 9, lineHeight: 1.2 } }, true, false));
      B.push(App.make.line({ x1: BX + 9.5, y1: BY + 3, x2: BX + 9.5, y2: BY + BH - 3, color: WHITE, width: 0.4, locked: true }));
    }
    // 3分割の目安の線（うすい点線。刷っても目立たない）
    if (K.split === 3) guideLines().forEach(function (l) { B.push(l); });
    (K.items || []).forEach(function (it) {
      if (it.k === "line" || it.k === "arrow") {
        if (!example && !it.keep) return;
        B.push(App.make.line({ x1: BX + it.x1, y1: BY + it.y1, x2: BX + it.x2, y2: BY + it.y2, color: it.color || WHITE, width: it.width || 0.5, arrow: it.k === "arrow" ? "end" : "none", dash: it.dash || "solid" }));
        return;
      }
      if (it.k === "rect") { B.push(R(BX + it.x, BY + it.y, it.w, it.h, { color: it.color || WHITE, width: it.width || 0.5, fill: "none", dash: it.dash || "solid" })); return; }
      if (it.only === "example" && !example) return;
      if (example && !it.t && !it.keep) return;   // 記入例で中身のない部品は置かない
      B.push(item(it, example, vertical));
    });
    // 黒板の下：発問と、予想される反応。黒板の3つの場所（縦書きは右から）にそろえる
    var ty = BY + BH + 6, th = 210 - 10 - ty - 7, order = vertical ? [2, 1, 0] : [0, 1, 2];
    (K.notes || []).forEach(function (n, i) {
      var nx = BX + Z * order[i] + (order[i] ? 2 : 0);
      B.push(T(nx, ty, Z - 4, 10.5, n[0] + "　発問と、予想される反応", { bold: true }));
      B.push(R(nx, ty + 7, Z - 4, th, { width: 0.4 }));
      B.push(T(nx + 1.5, ty + 8.5, Z - 7, 10, example ? n[1] : "", { h: th - 3, lineHeight: 1.55, hint: example ? "" : "①「発問」　→ 予想される反応" }));
    });
    return { doc: { version: 1, boardDir: vertical ? "v" : "h", title: K.name + (example && !K.free ? "（記入例）" : ""), paper: "A4", orient: "landscape", margin: 8, snap: 0.5, pages: [{ blocks: B }] } };
  };

  // 型のうすい字（hint）を出す
  var fill0 = App.fillBlock;
  App.fillBlock = function (el, b) {
    fill0(el, b);
    if (b.type !== "text") return;
    var tx = el.querySelector(".tx");
    if (!tx) return;
    if (b.hint) tx.setAttribute("data-hint", b.hint); else tx.removeAttribute("data-hint");
    el.classList.toggle("on-board", !!b.onBoard && !(b.fill && b.fill !== "none"));
  };

  /** 3分割の目安の線（2本）。guide3 の印をつけておき、あとから出したり消したりできる。 */
  function guideLines() {
    return [1, 2].map(function (i) {
      return App.make.line({ x1: BX + Z * i, y1: BY + 2.5, x2: BX + Z * i, y2: BY + BH - 2.5, color: GUIDE, width: 0.3, dash: "dash", locked: true, guide3: true });
    });
  }
  /** いまの紙の黒板に、3分割の線を出す。出ていれば消す。 */
  App.toggleGuide3 = function () {
    var pg = App.doc.pages[App.currentPage()], bd = pg.blocks.filter(function (r) { return r.type === "rect" && r.fill === GREEN; })[0];
    if (!bd) return;
    var had = pg.blocks.some(function (b) { return b.guide3; });
    if (had) pg.blocks = pg.blocks.filter(function (b) { return !b.guide3; });
    else {
      // 黒板の面のすぐ上（ほかの字の下）に入れる
      var at = pg.blocks.indexOf(bd) + 1, z = bd.w / 3;
      [1, 2].forEach(function (i, n) {
        pg.blocks.splice(at + n, 0, App.make.line({ x1: bd.x + z * i, y1: bd.y + 2.5, x2: bd.x + z * i, y2: bd.y + bd.h - 2.5, color: GUIDE, width: 0.3, dash: "dash", locked: true, guide3: true }));
      });
    }
    App.stopEditing(); App.selId = null; App.renderAll(); App.commit();
    App.toast(had ? "3分割の線を消しました。" : "3分割の線を出しました。うすい点線です。");
  };

  App.KATA = [];
  /** 型を足す。K = { key, subject, name, note, head, dir, split, items, notes } */
  App.addKata = function (K) { App.KATA.push(K); };
})();

;
/* マス目プリントメーカー：板書計画の型のデータ（教科ごと）
 * 行（r）は 0〜9。1つの場所（黒板の3分の1）に、1行13〜15字。記入例の文と数字は、どれも自作（教科書の文を写さない）。
 */
(function () {
  "use strict";
  var add = window.App.addKata;

  // ======================= 白紙の黒板 =======================
  add({ key: "free-h", subject: "白紙", free: true, name: "白紙の黒板（横書き）", note: "黒板と、左はしの日付だけ。左の「板書」から、めあて、まとめ、吹き出しなどを1つずつ置いていきます。", items: [], notes: [["はじめ", ""], ["なか", ""], ["おわり", ""]] });
  add({ key: "free-h3", subject: "白紙", free: true, name: "白紙の黒板（横書き、3分割の線つき）", note: "うすい点線で3つに分けてあります。線は、左の「板書」から、いつでも消したり出したりできます。", split: 3, items: [], notes: [["はじめ", ""], ["なか", ""], ["おわり", ""]] });
  add({ key: "free-v", subject: "白紙", free: true, name: "白紙の黒板（縦書き）", note: "国語、学級会、道徳などに。右はしの日付だけ。部品は縦書きで出ます。", dir: "v",
    items: [{ k: "moji", c: 0, cols: 1, top: 3, len: 40, t: "○月○日（○）", keep: true, o: { size: 9, lineHeight: 1.2 } }], notes: [["はじめ", ""], ["なか", ""], ["おわり", ""]] });

  // ======================= 算数 =======================
  add({
    key: "sansu-3", subject: "算数", name: "算数　3分割（問題、考え、まとめ）",
    note: "左に問題と前に習ったこと、まん中にめあてと考え方、右にたしかめの問題とまとめ。いちばんよく使う形です。",
    head: "板書計画　　4年　算数　「2けたでわるわり算」　本時 1／12　　ねらい：何十でわる計算のしかたを、10をもとにして考える。",
    split: 3,
    items: [
      { k: "moji", z: 0, r: 0, rows: 2, t: "90円でガムを買います。<br>1こ9円だと何こ買える？", hint: "はじめの問題（前に習った計算でできるもの）" },
      { k: "moji", z: 0, r: 2, x: 5, t: "90÷9＝10　答え10こ", hint: "式と答え" },
      { k: "moji", z: 0, r: 4, t: "1こ30円のガムだと？", hint: "今日の問題につなぐ問い" },
      { k: "moji", z: 0, r: 5, x: 5, w: 34, t: "90÷30＝", hint: "式" },
      { k: "kiiro", z: 0, r: 5, x: 41, w: 10, t: "？", only: "example" },
      { k: "fuki", z: 0, r: 7, x: 2, w: 60, h: 11, t: "9÷3と同じになりそう", hint: "子どものつぶやき", o: { align: "center" } },
      { k: "bango", z: 1, r: 0, w: 8.5, h: 8.5, t: "1", keep: true },
      { k: "moji", z: 1, r: 0, x: 10, rows: 2, t: "90÷30の計算のしかたを<br>考えましょう。", hint: "今日の問題" },
      { k: "meate", z: 1, y: 21.2, h: 19, t: "⑩をつかって、90÷30の<br>計算のしかたを考えよう。", hint: "めあて" },
      { k: "moji", z: 1, y: 43.5, t: "10円玉の9こと3こをくらべる", hint: "考え方（図、式、言葉）" },
      { k: "kiiro", z: 1, y: 51.1, x: 5, t: "⑩が（9÷3）こ → 3こ", hint: "大事な言葉（黄色）" },
      { k: "kakomi", z: 1, r: 8, x: 2, w: 80, h: 10.5, t: "たしかめ　3×30＝90", hint: "きまり、公式、たしかめ" },
      { k: "bango", z: 2, r: 0, w: 8.5, h: 8.5, t: "2", keep: true },
      { k: "moji", z: 2, r: 0, x: 10, rows: 2, t: "150円で、1こ30円の<br>ガムは何こ買えますか。", hint: "たしかめの問題" },
      { k: "moji", z: 2, r: 2, x: 5, t: "⑩が15こ　15÷3＝5", hint: "考え方" },
      { k: "moji", z: 2, r: 3, x: 5, t: "150÷30＝5　答え5こ", hint: "式と答え" },
      { k: "matome", z: 2, r: 5, h: 27, t: "⑩の何こ分かと考えると、<br>わる数が2けたでも、<br>計算できる。", hint: "まとめ（めあてとつながる言葉で）" },
      { k: "arrow", x1: 62, y1: 43, x2: 92.8, y2: 30, color: "#ffe066" }
    ],
    notes: [
      ["はじめ（10分）", "①「1こ9円なら、何こ買える？」<br>　→ 90÷9＝10（3年の計算でできる）<br>②「30円のガムなら？ 式は？」<br>　→ 90÷30。わる数が2けたは初めて<br>　→「9÷3と同じになりそう」を吹き出しで残す"],
      ["考える（25分）", "③「10円玉で考えると、90円は何こ？ 30円は？」<br>　→ 9こと3こ。9÷3＝3<br>④「3で本当に正しい？ どうやって確かめる？」<br>　→ 3×30＝90（たしかめの式を黄色で囲む）<br>・手が止まる子には、10円玉の図をかかせる"],
      ["まとめる（10分）", "⑤ 2番を自分で解く。「⑩が何こ？」<br>　→ 15こ。15÷3＝5<br>⑥「今日分かったことを、自分の言葉で」<br>　→ 子どもの言葉をつないで、まとめにする<br>・めあてと、まとめがつながっているかを見る"]
    ]
  });

  add({
    key: "sansu-kurabe", subject: "算数", name: "算数　考えをならべてくらべる",
    note: "まん中に、子どもの考えを2つか3つならべます。同じところに線を引いて、右でまとめます。面積や、計算のくふうの時間に。",
    head: "板書計画　　4年　算数　「面積」　本時 6／10　　ねらい：L字の形の面積を、長方形に分けたり、おぎなったりして求める。",
    split: 3,
    items: [
      { k: "bango", z: 0, r: 0, w: 8.5, h: 8.5, t: "1", keep: true },
      { k: "moji", z: 0, r: 0, x: 10, rows: 2, t: "右の形の面積は<br>何cm²ですか。", hint: "今日の問題" },
      { k: "shiryo", z: 0, r: 2, x: 8, w: 52, h: 26, t: "（L字の形の図）<br>たて6cm、よこ8cm<br>かけた所 3cm×4cm", hint: "図（かくか、紙を貼る）" },
      { k: "meate", z: 0, y: 51, h: 19, t: "長方形でない形の面積の<br>求め方を考えよう。", hint: "めあて" },
      { k: "midashi", z: 1, r: 0, w: 40, t: "分ける（○○さん）", hint: "考え①の名前" },
      { k: "moji", z: 1, r: 1, rows: 3, t: "たてに切って2つの長方形<br>6×4＝24　3×4＝12<br>24＋12＝36", hint: "考え①（図、式）" },
      { k: "midashi", z: 1, r: 5, w: 40, t: "ひく（△△さん）", hint: "考え②の名前" },
      { k: "moji", z: 1, r: 6, rows: 3, t: "大きい長方形からひく<br>6×8＝48　3×4＝12<br>48−12＝36", hint: "考え②（図、式）" },
      { k: "kiiro", z: 2, r: 0, rows: 2, t: "どちらも<br>長方形にして考えている", hint: "考えの同じところ（黄色）" },
      { k: "bango", z: 2, r: 3, w: 8.5, h: 8.5, t: "2", keep: true },
      { k: "moji", z: 2, r: 3, x: 10, t: "コの字の形でもできる？", hint: "たしかめの問題" },
      { k: "matome", z: 2, r: 5, h: 27, t: "長方形でない形も、<br>長方形に分けたり、<br>ひいたりすれば求められる。", hint: "まとめ" },
      { k: "arrow", x1: 170, y1: 22, x2: 187, y2: 12, color: "#ffe066" },
      { k: "arrow", x1: 170, y1: 60, x2: 187, y2: 16, color: "#ffe066" }
    ],
    notes: [
      ["はじめ（8分）", "①「この形、今までの形とどこがちがう？」<br>　→ 長方形じゃない。へこんでいる<br>②「公式はそのまま使える？」<br>　→ 使えない。でも長方形にすればできそう"],
      ["考える（27分）", "③ 自分の考えを図と式でノートに（7分）<br>④「○○さんの式の 6×4 は、図のどこ？」<br>　→ 式と図を線でつながせる<br>⑤「2つの考えの同じところは？」<br>　→ どちらも長方形にしている（黄色で書く）"],
      ["まとめる（10分）", "⑥ 2番：コの字の形。「どの考えが使いやすい？」<br>　→ ひく考えが早い、分けてもできる<br>⑦ まとめを自分の言葉で書く"]
    ]
  });

  // ======================= 理科 =======================
  add({
    key: "rika-3", subject: "理科", name: "理科　3分割（問題と予想、実験、考察と結論）",
    note: "左に問題と予想（人数も）、まん中に実験の方法と結果、右に考察と結論。4年は、予想に理由を書く場所をとります。",
    head: "板書計画　　4年　理科　「とじこめた空気と水」　本時 2／7　　ねらい：とじこめた空気をおしたときの、体積と手ごたえの変わり方を調べる。",
    split: 3,
    items: [
      { k: "meate", z: 0, r: 0, h: 19, t: "とじこめた空気をおすと、<br>体積はどうなるだろうか。", hint: "問題", o: { bandLabel: "問題" } },
      { k: "midashi", z: 0, y: 25, w: 30, t: "予想", keep: true },
      { k: "moji", z: 0, y: 33, rows: 2, t: "ア 小さくなる　　18人<br>イ 変わらない　　 9人", hint: "予想と人数" },
      { k: "fuki", z: 0, y: 50, x: 2, w: 72, h: 17, t: "理由：空気でっぽうの玉をおしたとき、少しちぢんだ感じがしたから", hint: "予想の理由（前に習ったこと、生活の中のこと）" },
      { k: "midashi", z: 1, r: 0, w: 40, t: "実験の方法", keep: true },
      { k: "shiryo", z: 1, r: 1, x: 2, w: 40, h: 24, t: "（ちゅうしゃ器の図）<br>空気を入れて、<br>先をゴムの板におしつける", hint: "器具の図（かくか、貼る）" },
      { k: "moji", z: 1, r: 1, x: 45, w: 42, rows: 3, o: { size: 12 }, t: "①目もりを読む<br>②ピストンをおす<br>③手をはなす", hint: "手順" },
      { k: "midashi", z: 1, y: 35.5, w: 30, t: "結果", keep: true },
      { k: "waku", z: 1, y: 43.5, w: 86, h: 31, o: { size: 12, lineHeight: 1.5 }, t: "おす前　　　20の目もり<br>おしたとき　12の目もり（手ごたえ大）<br>はなしたとき　20にもどった", hint: "結果（表、目もり、見えたこと）" },
      { k: "midashi", z: 2, r: 0, w: 30, t: "考察", keep: true },
      { k: "moji", z: 2, r: 1, rows: 3, t: "目もりがへったので、<br>空気はおされると<br>体積が小さくなるといえる。", hint: "考察（結果から言えること）" },
      { k: "matome", z: 2, r: 5, h: 27, t: "とじこめた空気をおすと、<br>体積は小さくなり、<br>おし返す力は大きくなる。", hint: "結論（問題への答え）", o: { bandLabel: "結論" } }
    ],
    notes: [
      ["問題と予想（12分）", "①「空気でっぽうの玉は、どうしてとんだのかな」<br>　→ 空気がおされて、ちぢんだ？<br>②「予想に手をあげよう。理由は？」<br>　→ 理由を1つ、吹き出しで残す（4年は根拠のある予想）"],
      ["実験と結果（20分）", "③ 方法をたしかめる。「目もりはどこを読む？」<br>④ 班で実験。結果は目もりの数で書く<br>・おしすぎない。先をしっかりおさえる"],
      ["考察と結論（13分）", "⑤「結果から、どんなことがいえる？」<br>　→「〜ので、〜といえる」の形で書かせる<br>⑥「はじめの問題に答えよう」<br>　→ 予想とくらべて、結論を書く"]
    ]
  });

  add({
    key: "rika-wb", subject: "理科", name: "理科　班のホワイトボードを6枚貼る",
    note: "各班の結果や考えを書いたホワイトボードを、まん中に6枚ならべて貼ります。同じところに印をつけて、右で結論にまとめます。",
    head: "板書計画　　4年　理科　「物の温度と体積」　本時 3／7　　ねらい：空気をあたためたり冷やしたりしたときの、体積の変わり方を調べる。",
    items: [
      { k: "meate", x: 11, r: 0, w: 66, h: 19, t: "空気は、温度によって<br>体積が変わるのだろうか。", hint: "問題", o: { bandLabel: "問題", size: 14 } },
      { k: "midashi", x: 11, y: 26, w: 30, t: "予想", keep: true },
      { k: "moji", x: 11, y: 33.5, w: 66, rows: 2, o: { size: 14 }, t: "大きくなる　20人<br>変わらない　 7人", hint: "予想と人数" },
      { k: "fuki", x: 12, y: 51, w: 64, h: 22, o: { size: 12 }, t: "理由：へこんだピンポン玉をお湯に入れると、元にもどったから", hint: "予想の理由" },
      { k: "line", x1: 80, y1: 3, x2: 80, y2: 75, color: "#86aa9c", width: 0.3, dash: "dash", keep: true },
      { k: "midashi", x: 83, r: 0, w: 60, t: "各班の結果", keep: true },
      { k: "wb", x: 83, y: 12, w: 36, h: 29, t: "1班<br>湯：まくがふくらんだ<br>氷水：まくがへこんだ", hint: "1班" },
      { k: "wb", x: 121, y: 12, w: 36, h: 29, t: "2班<br>湯：ふくらんだ<br>氷水：下がった", hint: "2班" },
      { k: "wb", x: 159, y: 12, w: 36, h: 29, t: "3班<br>湯：まくが高くなった<br>氷水：中に入った", hint: "3班" },
      { k: "wb", x: 83, y: 44, w: 36, h: 29, t: "4班<br>湯：ふくらんだ<br>手であたためても<br>少しふくらんだ", hint: "4班" },
      { k: "wb", x: 121, y: 44, w: 36, h: 29, t: "5班<br>湯：ふくらんだ<br>氷水：へこんだ", hint: "5班" },
      { k: "wb", x: 159, y: 44, w: 36, h: 29, t: "6班<br>湯：ふくらんだ<br>氷水：へこんだ<br>元の温度でもどった", hint: "6班" },
      { k: "line", x1: 198, y1: 3, x2: 198, y2: 75, color: "#86aa9c", width: 0.3, dash: "dash", keep: true },
      { k: "midashi", x: 201, r: 0, w: 30, t: "考察", keep: true },
      { k: "kiiro", x: 201, r: 1, w: 72, rows: 2, o: { size: 14 }, t: "どの班も、湯でふくらみ、<br>氷水でへこんだ", hint: "どの班にも同じところ（黄色）" },
      { k: "matome", x: 201, r: 4, w: 72, h: 30, o: { size: 14, bandLabel: "結論" }, t: "空気は、あたためると<br>体積が大きくなり、<br>冷やすと小さくなる。", hint: "結論（問題への答え）" }
    ],
    notes: [
      ["問題と予想（10分）", "①「へこんだピンポン玉が、お湯でもどったのはなぜ？」<br>②「予想と理由をノートに」<br>　→ 人数を書く。理由を1つ吹き出しに"],
      ["実験（22分）", "③ 班で実験（試験管の口にせっけんのまく）<br>④ ホワイトボードに「見えたことだけを書こう」<br>⑤ 書けた班から黒板に貼る（班の番号の順）<br>・湯は60度くらい。やけどに注意"],
      ["考察と結論（13分）", "⑥「6枚をくらべて、同じところは？」<br>　→ 同じ言葉に黄色で線を引く<br>⑦「ちがう結果の班は、どうしてだろう」<br>⑧ 結論を自分の言葉で書く"]
    ]
  });
})();

;
/* マス目プリントメーカー：板書計画の型のデータ（国語。縦書き）
 * c は右から何列めか（0〜34）。1列は 7.6mm。top と len は、黒板の上はしからの mm。1列に入る字は、16pt で12字、13pt で15字まで。
 * 記入例の話と文は、どれも自作（教科書の文を写さない）。物語は、転校生のユイと、となりの席のソウタの話。説明文は「町の橋のくふう」。
 */
(function () {
  "use strict";
  var add = window.App.addKata;
  var S13 = { size: 13 }, S12 = { size: 12 };
  // 右はしの決まった置き方：日付、題名と作者、めあて
  function head(title, author, meate, meateCols, authorHint) {
    return [
      { k: "moji", c: 0, cols: 1, top: 3, len: 40, t: "○月○日（○）", keep: true, o: { size: 9, lineHeight: 1.2 } },
      { k: "moji", c: 1, cols: 1, top: 4, len: author ? 44 : 70, t: title, hint: "題名" },
      { k: "moji", c: 2, cols: 1, top: 50, len: 26, t: author, hint: authorHint || "作者", o: S12 },
      { k: "meate", c: 3.2, cols: meateCols || 3, top: 8, len: 66, t: meate, hint: "めあて" }
    ];
  }

  function v(k, c, cols, top, len, t, hint, o, more) { return Object.assign({ k: k, c: c, cols: cols, top: top, len: len, t: t, hint: hint, o: o }, more || {}); }
  function keep(k, c, cols, top, len, t, o) { return { k: k, c: c, cols: cols, top: top, len: len, t: t, keep: true, o: o }; }
  var NOTE_K = ["はじめ（8分）", "読み深める（27分）", "まとめる（10分）"];

  add({
    key: "kokugo-bamen", subject: "国語", name: "国語　場面を右から順にならべる（物語）",
    note: "右から場面一、二、三。上の段に行動や会話、下の段にそのときの気持ち。気持ちの移り変わりを追う時間に。",
    head: "板書計画　　4年　国語　物語文「となりの席」（自作の話）　本時 4／8　　ねらい：行動や会話から、ソウタの気持ちの変化を読む。",
    dir: "v",
    items: head("となりの席", "（作者）", "ソウタの気持ちは、<br>どこでかわったのだろう。").concat([
      { k: "arrow", x1: 212, y1: 39.5, x2: 66, y2: 39.5, color: "#ffe066", width: 0.4, keep: true },
      keep("midashi", 7, 1, 4, 32, "行動・会話", S12), keep("midashi", 7, 1, 42, 30, "気持ち", S12),
      keep("bango", 8.4, 1, 4, 8.5, "一"),
      v("moji", 9.7, 3, 3, 35, "目を合わせない<br>本を読んでいる", "場面一の行動や会話", S13),
      v("kiiro", 9.7, 3, 41, 35, "話し方が<br>分からない", "そのときの気持ち", S13),
      keep("bango", 14.4, 1, 4, 8.5, "二"),
      v("moji", 15.7, 3, 3, 35, "消しゴムをかす<br>「つかえば」", "場面二の行動や会話", S13),
      v("kiiro", 15.7, 3, 41, 35, "こまった顔を<br>ほうって<br>おけない", "そのときの気持ち", S13),
      keep("bango", 20.4, 1, 4, 8.5, "三"),
      v("moji", 21.7, 3, 3, 35, "自分からさそう<br>「いっしょに<br>行こう」", "場面三の行動や会話", S13),
      v("kiiro", 21.7, 3, 41, 35, "もっと話したい<br>友だちに<br>なりたい", "そのときの気持ち", S13),
      v("matome", 30.2, 3.7, 8, 66, "ソウタは、ユイのこまった顔を見てから、自分から近づくようになった。", "まとめ", { size: 14 })
    ]),
    notes: [
      [NOTE_K[0], "①「ソウタは、はじめとおわりで同じ人かな」<br>　→ ちがう。さいごは自分からさそっている<br>②「どこでかわったのか、場面ごとに見ていこう」"],
      [NOTE_K[1], "③「場面一のソウタの行動は？ 気持ちは？」<br>　→ 行動は白、気持ちは黄色で書き分ける<br>④「消しゴムをかすとき、声が小さいのはなぜ？」<br>　→ はずかしい。でも、ほうっておけない<br>・本文のどの言葉から分かるかを必ず聞く"],
      [NOTE_K[2], "⑤「気持ちが大きくかわったのは、どの場面？」<br>　→ 場面二。まん中の矢印を指でたどらせる<br>⑥ まとめを自分の言葉で書く"]
    ]
  });

  add({
    key: "kokugo-taihi", subject: "国語", name: "国語　二つをくらべる（対比）",
    note: "まん中を上下2段に分けて、はじめとおわり、二人の人物などを同じ高さでくらべます。左はしに、くらべて分かったこと。",
    head: "板書計画　　4年　国語　物語文「となりの席」（自作の話）　本時 6／8　　ねらい：はじめとおわりの場面をくらべて、二人の関係の変化をとらえる。",
    dir: "v",
    items: head("となりの席", "（作者）", "はじめの場面とおわりの<br>場面をくらべよう。").concat([
      { k: "line", x1: 90, y1: 39.5, x2: 225, y2: 39.5, color: "#ffffff", width: 0.4, keep: true },
      keep("kakomi", 6.8, 1.2, 5, 30, "はじめ", { size: 14 }), keep("kakomi", 6.8, 1.2, 43, 30, "おわり", { size: 14 }),
      v("midashi", 9, 1, 4, 22, "会話", "観点①", S12),
      v("moji", 10.2, 2, 3, 35, "「……」<br>返事をしない", "はじめ：観点①", S13),
      v("moji", 10.2, 2, 41, 35, "「いっしょに<br>行こう」", "おわり：観点①", S13),
      v("midashi", 14, 1, 4, 22, "きょり", "観点②", S12),
      v("moji", 15.2, 2, 3, 35, "つくえをはなす", "はじめ：観点②", S13),
      v("moji", 15.2, 2, 41, 35, "ならんで歩く", "おわり：観点②", S13),
      v("midashi", 19, 1, 4, 22, "消しゴム", "観点③", S12),
      v("moji", 20.2, 2, 3, 35, "だまってかす", "はじめ：観点③", S13),
      v("moji", 20.2, 2, 41, 35, "二人で使う", "おわり：観点③", S13),
      { k: "arrow", x1: 173, y1: 30, x2: 173, y2: 49, color: "#ffe066", only: "example" },
      { k: "arrow", x1: 135, y1: 30, x2: 135, y2: 49, color: "#ffe066", only: "example" },
      { k: "arrow", x1: 97, y1: 30, x2: 97, y2: 49, color: "#ffe066", only: "example" },
      v("fuki", 25, 2.6, 8, 60, "席は同じなのに、<br>きょりがちがう", "子どもの気づき", { size: 12 }),
      v("matome", 30.2, 3.7, 8, 66, "同じ教室でも、二人の間がちぢまったことが、会話の数やきょりで分かる。", "くらべて分かったこと", { size: 14 })
    ]),
    notes: [
      [NOTE_K[0], "①「はじめとおわりで、にているところは？」<br>　→ 同じ教室、同じ席、消しゴムが出てくる<br>②「では、ちがうところをくらべよう」"],
      [NOTE_K[1], "③ 観点（会話、きょり、消しゴム）は子どもから出させる<br>④「上と下で、いちばんかわったのは？」<br>　→ 会話。だまっていたのに、自分からさそった<br>・上下の同じ高さに書いて、矢印でつなぐ"],
      [NOTE_K[2], "⑤「くらべると、何が分かった？」<br>⑥ まとめを書く。「〜で分かる」の形で"]
    ]
  });

  add({
    key: "kokugo-hyo", subject: "国語", name: "国語　表にまとめる",
    note: "右に場面や段落、上に観点を書いた大きな表。表の左に、気づいたことを書きます。",
    head: "板書計画　　4年　国語　物語文「となりの席」（自作の話）　本時 5／8　　ねらい：場面ごとの行動、会話、持ち物を表に整理して、かわったところを見つける。",
    dir: "v",
    items: head("となりの席", "（作者）", "表にして、かわった<br>ところを見つけよう。").concat([
      { k: "line", x1: 95, y1: 6, x2: 95, y2: 74, keep: true }, { k: "line", x1: 222, y1: 6, x2: 222, y2: 74, keep: true },
      { k: "line", x1: 95, y1: 6, x2: 222, y2: 6, keep: true }, { k: "line", x1: 95, y1: 74, x2: 222, y2: 74, keep: true },
      { k: "line", x1: 95, y1: 28, x2: 222, y2: 28, keep: true }, { k: "line", x1: 95, y1: 51, x2: 222, y2: 51, keep: true },
      { k: "line", x1: 206, y1: 6, x2: 206, y2: 74, keep: true }, { k: "line", x1: 153, y1: 6, x2: 153, y2: 74, keep: true },
      keep("midashi", 7.7, 1, 8, 19, "行動", S12), keep("midashi", 7.7, 1, 30, 19, "会話", S12), keep("midashi", 7.7, 1, 53, 19, "持ち物", S12),
      keep("kiiro", 9.6, 1, 7, 20, "場面一", { size: 12 }),
      v("moji", 10.8, 3, 7, 20, "本を読む", "行動", S12), v("moji", 10.8, 3, 29.5, 20, "「……」", "会話", { size: 11 }), v("moji", 10.8, 3, 52.5, 20, "消しゴム", "持ち物", S12),
      keep("kiiro", 17, 1, 7, 20, "場面四", { size: 12 }),
      v("moji", 18.2, 3, 7, 20, "さそう", "行動", S12), v("moji", 18.2, 3, 29.5, 20, "「行こう」", "会話", { size: 11 }), v("moji", 18.2, 3, 52.5, 20, "消しゴム", "持ち物", S12),
      v("fuki", 25.2, 2.6, 8, 60, "消しゴムが、<br>どちらにも出てくる", "表を見て気づいたこと", { size: 12 }),
      v("matome", 30.2, 3.7, 8, 66, "消しゴムが、二人をつなぐ物になっている。", "まとめ", { size: 14 })
    ]),
    notes: [
      [NOTE_K[0], "①「場面一と場面四を、表でくらべます」<br>②「何をくらべる？」→ 行動、会話、持ち物"],
      [NOTE_K[1], "③ 表のますを、子どもの言葉でうめる<br>④「表をよこに見ると、何に気づく？」<br>　→ 会話がふえた。消しゴムはどちらにもある<br>・同じ言葉を黄色で囲む"],
      [NOTE_K[2], "⑤「消しゴムは、この話で何の役目？」<br>⑥ まとめを書く"]
    ]
  });

  add({
    key: "kokugo-jinbutsu", subject: "国語", name: "国語　人物像を広げる（まん中に人物）",
    note: "まん中に人物の名前を置いて、まわりに「どんな人か」を書き広げます。いちばん多い考えを太く囲みます。",
    head: "板書計画　　4年　国語　物語文「となりの席」（自作の話）　本時 3／8　　ねらい：行動や会話をもとに、ユイの人物像を考える。",
    dir: "v",
    items: head("となりの席", "（作者）", "ユイは、どんな人だろう。", 2).concat([
      v("waku", 6.3, 1.4, 8, 64, "ユイは□□な人。なぜなら〜", "○○は□□な人。なぜなら〜", { size: 13 }),
      v("kakomi", 17.2, 1.6, 27, 24, "ユイ", "人物", { size: 18 }),
      v("fuki", 9.5, 2.4, 5, 30, "がまん強い<br>（七人）", "考え", S12), v("fuki", 9.5, 2.4, 42, 32, "お礼をきちんと言う（五人）", "考え", S12),
      v("fuki", 13.2, 1.5, 3, 22, "やさしい", "考え", S12), v("fuki", 13.2, 1.5, 50, 26, "しんが強い", "考え", S12),
      v("fuki", 21, 1.5, 3, 31, "はずかしがり", "考え", S12), v("fuki", 21, 1.5, 50, 26, "友だち思い", "考え", S12),
      v("fuki", 24.2, 2.4, 5, 32, "本当は話したい（九人）", "考え", { size: 12, borderColor: "#ffe066" }), v("fuki", 24.2, 2.4, 42, 32, "えんりょする<br>（六人）", "考え", S12),
      v("matome", 30.2, 3.7, 8, 66, "ユイは、えんりょしながらも、相手を大切にする人。", "まとめ", { size: 14 })
    ]),
    notes: [
      [NOTE_K[0], "①「ユイを一言で言うと？」→ ノートに1つ書く<br>② 書き出しの型「ユイは□□な人。なぜなら〜」をしめす"],
      [NOTE_K[1], "③「なぜなら、の後を本文の言葉で言おう」<br>　→「『ありがとう』を小さな声で言ったから」<br>④ 人数を聞いて書く。多い考えを黄色で囲む<br>・にている考えは近くに書く"],
      [NOTE_K[2], "⑤「みんなの考えをつなぐと、どんな人？」<br>⑥ まとめを書く"]
    ]
  });

  add({
    key: "kokugo-kankei", subject: "国語", name: "国語　人物の関係を図にする",
    note: "人物を2人はなして置き、思いの向きを矢印で表します。矢印のそばに、本文の言葉と気持ちを書きます。",
    head: "板書計画　　4年　国語　物語文「となりの席」（自作の話）　本時 7／8　　ねらい：二人の思いの向きの変化を、矢印で表して読む。",
    dir: "v",
    items: head("となりの席", "（作者）", "二人の思いの向きを、<br>矢印で表そう。").concat([
      v("kakomi", 8.2, 1.6, 6, 22, "ユイ", "人物", { size: 18 }), v("kakomi", 8.2, 1.6, 50, 22, "ソウタ", "人物", { size: 16 }),
      keep("midashi", 6.9, 1, 6, 18, "はじめ", S12),
      { k: "arrow", x1: 204.5, y1: 30, x2: 204.5, y2: 48, color: "#ffffff", keep: true },
      v("moji", 9.8, 1.2, 27, 25, "話したい", "ユイからソウタへの思い", S12),
      v("fuki", 12.6, 2.6, 14, 50, "消しゴムの場面で、<br>ソウタがかわった", "かわったきっかけ", { size: 12 }),
      { k: "arrow", x1: 186, y1: 70, x2: 140, y2: 70, color: "#ffe066", keep: true },
      v("kakomi", 18.4, 1.6, 6, 22, "ユイ", "人物", { size: 18 }), v("kakomi", 18.4, 1.6, 50, 22, "ソウタ", "人物", { size: 16 }),
      keep("midashi", 17.2, 1, 6, 18, "おわり", S12),
      { k: "arrow", x1: 128, y1: 30, x2: 128, y2: 48, color: "#ffffff", keep: true }, { k: "arrow", x1: 122, y1: 48, x2: 122, y2: 30, color: "#ffe066", keep: true },
      v("moji", 20.8, 1.2, 26, 27, "ありがとう", "ユイの思い", S12), v("kiiro", 22.2, 2, 28, 22, "友だちに<br>なりたい", "ソウタの思い", S12),
      v("matome", 30.2, 3.7, 8, 66, "矢印が一本から二本になり、二人の思いが通い合った。", "まとめ", { size: 14 })
    ]),
    notes: [
      [NOTE_K[0], "①「はじめ、思いはだれからだれへ向いている？」<br>　→ ユイからソウタへだけ"],
      [NOTE_K[1], "②「ソウタからの矢印は、いつ出てくる？」<br>　→ 消しゴムの場面のあと<br>③「矢印に言葉をつけるなら？」→ 本文の言葉でつける<br>・矢印の色で、だれの思いかを分ける"],
      [NOTE_K[2], "④「はじめとおわりの図をくらべると？」<br>⑤ まとめを書く"]
    ]
  });

  add({
    key: "kokugo-danraku", subject: "国語", name: "国語　段落のまとまりを見せる（説明文）",
    note: "上に「はじめ、中、終わり」の帯。その下に段落番号を右からならべて、一言の要点を書きます。左に筆者の考え。",
    head: "板書計画　　4年　国語　説明文「町の橋のくふう」（自作の文）　本時 2／7　　ねらい：段落を「はじめ、中、終わり」に分けて、筆者の考えを見つける。",
    dir: "v",
    items: head("町の橋のくふう", "（筆者）", "筆者の考えを、<br>段落から見つけよう。", 3, "筆者").concat([
      v("kakomi", 7, 2.2, 4, 12, "はじめ", "", { size: 11, dir: "h" }, { keep: true }), v("kakomi", 10.5, 12, 4, 12, "中", "", { size: 11, dir: "h" }, { keep: true }), v("kakomi", 23.8, 3.8, 4, 12, "終わり", "", { size: 11, dir: "h" }, { keep: true }),
      keep("bango", 7.3, 1, 19, 8, "①", { size: 13 }), v("moji", 8.4, 1, 19, 55, "問い　橋のくふうとは", "①の要点", S13),
      keep("bango", 10.8, 1, 19, 8, "②", { size: 13 }), v("moji", 11.9, 2, 19, 55, "例一　川の橋<br>水の流れに合わせる", "②の要点", S13),
      keep("bango", 15, 1, 19, 8, "③", { size: 13 }), v("moji", 16.1, 2, 19, 55, "例二　歩道橋<br>歩く人に合わせる", "③の要点", S13),
      keep("bango", 19.2, 1, 19, 8, "④", { size: 13 }), v("moji", 20.3, 2, 19, 55, "例三　つり橋<br>場所に合わせる", "④の要点", S13),
      keep("bango", 24.2, 1, 19, 8, "⑤", { size: 13 }), v("kiiro", 25.3, 2, 19, 55, "答え　使う人や場所に合わせて作る", "⑤の要点（答え）", S13),
      v("matome", 30.2, 3.7, 8, 66, "筆者は、三つの例で、橋は使う人や場所に合わせて作られると伝えている。", "筆者の考え", { size: 14 })
    ]),
    notes: [
      [NOTE_K[0], "①「この文章は、いくつの段落？」→ 5つ<br>②「問いの文はどこ？」→ ①段落"],
      [NOTE_K[1], "③「②③④は、何が書いてある？」→ 橋の例<br>④「3つの例に同じ言葉は？」→「〜に合わせる」<br>　→ 同じ言葉に黄色で線を引く<br>・要点は一言で。長く書かない"],
      [NOTE_K[2], "⑤「答えはどの段落？」→ ⑤<br>⑥ 筆者の考えを一文で書く"]
    ]
  });

  add({
    key: "kokugo-honbun", subject: "国語", name: "国語　本文を貼って書きこむ",
    note: "拡大した本文（または手本の文）をまん中に貼り、言葉に線を引いて、わきに名前の札をつけます。書くことの推敲にも。",
    head: "板書計画　　4年　国語　書くこと「ようすが伝わる文」（自作の手本）　本時 3／6　　ねらい：手本の文から、ようすが伝わる言葉を見つけて、自分の文に生かす。",
    dir: "v",
    items: head("ようすが伝わる文", "", "ようすが伝わる言葉を<br>さがそう。").concat([
      v("shiryo", 8, 10, 5, 68, "（拡大した手本の文を貼る）<br>朝、まどをそっとあけると、つめたい風がすうっと入ってきた。<br>遠くで、カンカンとふみきりの音がした。", "拡大した本文を貼る", { size: 12, align: "start" }),
      v("tanzaku", 18.6, 1.2, 8, 26, "見たこと", "名前の札", { size: 12 }), v("tanzaku", 20.2, 1.2, 8, 26, "聞いたこと", "名前の札", { size: 12 }), v("tanzaku", 21.8, 1.2, 8, 26, "思ったこと", "名前の札", { size: 12 }),
      v("moji", 18.6, 1.2, 38, 36, "「そっと」", "見つけた言葉", S13), v("moji", 20.2, 1.2, 38, 36, "「カンカン」", "見つけた言葉", S13), v("moji", 21.8, 1.2, 38, 36, "「つめたい」", "見つけた言葉", S13),
      v("fuki", 24.2, 2.6, 8, 60, "「そっと」で、<br>やさしさが分かる", "子どもの気づき", { size: 12 }),
      v("matome", 30.2, 3.7, 8, 66, "見たこと、聞いたこと、思ったことを入れると、ようすが伝わる。", "まとめ", { size: 14 })
    ]),
    notes: [
      [NOTE_K[0], "① 手本を音読。「ようすがうかぶ言葉は？」<br>　→ 線を引かせる"],
      [NOTE_K[1], "②「その言葉は、見たこと？ 聞いたこと？」<br>　→ 名前の札の下に分けて書く<br>③「『そっと』がないと、どうなる？」<br>　→ くらべて読む"],
      [NOTE_K[2], "④ まとめ<br>⑤ 自分の文に1つ足す（5分）"]
    ]
  });

  add({
    key: "kokugo-susumekata", subject: "国語", name: "国語　学習の進め方をしめす（書く、話す聞く）",
    note: "まん中に進め方①②③と気をつけること。左に、子どもから出た例や、話し方の型。単元の1時間目や、話し合いの時間に。",
    head: "板書計画　　4年　国語　話すこと聞くこと「おすすめの本を決めよう」　本時 2／5　　ねらい：理由をくらべながら話し合い、はんのおすすめの本を一さつ決める。",
    dir: "v",
    items: head("おすすめの本を決めよう", "", "話し合って、おすすめの<br>本を一さつ決めよう。").concat([
      keep("midashi", 7.3, 1, 4, 30, "進め方", S12),
      v("moji", 8.4, 1, 5, 68, "①一人ずつ、本と理由を言う", "進め方①", { size: 14 }), v("moji", 9.6, 1, 5, 68, "②理由をくらべる", "進め方②", { size: 14 }),
      v("moji", 11, 1, 5, 68, "③一さつに決める", "進め方③", { size: 14 }), v("moji", 12.4, 1, 5, 68, "④決めた理由を書く", "進め方④", { size: 14 }),
      keep("midashi", 14.6, 1, 4, 40, "話し方の型", S12),
      v("kakomi", 15.8, 2.4, 5, 68, "わたしは〜がいいと思います。<br>なぜなら、〜だからです。", "話し方の型", { size: 13, align: "start" }),
      keep("midashi", 19.4, 1, 4, 40, "気をつけること", S12),
      v("fuki", 20.6, 2.4, 5, 32, "理由を先に言う", "子どもから出た言葉", S12), v("fuki", 20.6, 2.4, 41, 34, "ちがう考えも<br>一度聞く", "子どもから出た言葉", S12),
      v("fuki", 24, 2.4, 5, 32, "決め方も<br>話し合う", "子どもから出た言葉", S12),
      v("matome", 30.2, 3.7, 8, 66, "理由をくらべると、みんながなっとくして決めやすい。", "まとめ、ふり返り", { size: 14 })
    ]),
    notes: [
      [NOTE_K[0], "①「一さつに決めるとき、こまることは？」<br>　→ 意見が分かれる。声の大きい人で決まる<br>② 進め方をたしかめる"],
      [NOTE_K[1], "③ はんで話し合い（15分）。タイマーを貼る<br>④ とちゅうで止めて「うまくいっているはんのやり方は？」<br>　→ 出た言葉を吹き出しで残す"],
      [NOTE_K[2], "⑤「決めやすかったのは、どんなとき？」<br>⑥ ふり返りを書く"]
    ]
  });

  // ======================= 学級会（縦書き） =======================
  add({
    key: "gakkyu-kihon", subject: "学級会", name: "学級会　議題、柱、決まったこと",
    note: "右はしに議題、提案理由、めあて、決まっていること。まん中に柱①②と意見の短冊。左に決まったこと。黒板記録の子が書きます。",
    head: "板書計画　　4年　学級活動　第5回学級会　　ねらい：全員が楽しめるかを考えて、お楽しみ会の内容を決める。",
    dir: "v",
    items: [
      v("moji", 0, 1, 3, 50, "第五回　学級会", "第○回　学級会", { size: 12 }),
      keep("tanzaku", 1.2, 1.2, 4, 14, "議題", { size: 11 }), v("moji", 1.2, 1.2, 20, 56, "お楽しみ会で何をするか", "議題", { size: 13 }),
      keep("tanzaku", 2.6, 1.2, 4, 22, "提案理由", { size: 11 }), v("moji", 3.9, 1.6, 4, 72, "新しい友だちが入ったので、みんなで遊んで、もっとなかよくなりたいから。", "提案理由", { size: 11 }),
      v("meate", 6.4, 2.7, 8, 66, "全員が楽しめるかを<br>考えて決めよう。", "話し合いのめあて", { size: 13 }),
      keep("tanzaku", 9.5, 1.2, 4, 36, "決まっていること", { size: 11 }), v("moji", 10.8, 1.6, 4, 72, "十月十日の五時間目　教室で<br>ゲームは二つで三十分", "日時、場所、時間など", { size: 11 }),
      { k: "line", x1: 176.5, y1: 3, x2: 176.5, y2: 75, color: "#ffffff", width: 0.4, keep: true },
      keep("kakomi", 13.1, 1.2, 4, 40, "柱①　何をするか", { size: 11 }),
      v("moji", 14.4, 0.9, 4, 72, "出し合う → くらべ合う → まとめる", "", { size: 10, color: "#ffe066" }, { keep: true }),
      v("tanzaku", 15.4, 1.3, 4, 38, "フルーツバスケット", "意見の短冊", { size: 10 }), v("tanzaku", 16.9, 1.3, 4, 38, "クイズ大会", "意見の短冊", { size: 10 }),
      v("tanzaku", 18.4, 1.3, 4, 38, "いす取りゲーム", "意見の短冊", { size: 10 }), v("tanzaku", 19.9, 1.3, 4, 38, "じゃんけん列車", "意見の短冊", { size: 10 }),
      v("moji", 15.4, 1.3, 43, 33.5, "◎全員できる７人", "賛成や心配", { size: 10 }), v("moji", 16.9, 1.3, 43, 33.5, "◎考えて楽しい９人", "賛成や心配", { size: 10 }),
      v("moji", 18.4, 1.3, 44, 32, "△負けるとひま", "賛成や心配", { size: 11 }), v("moji", 19.9, 1.3, 44, 32, "△教室はせまい", "賛成や心配", { size: 11 }),
      keep("kakomi", 21.6, 1.3, 4, 46, "柱②　楽しめるくふう", { size: 11 }),
      v("moji", 23.1, 1.7, 4, 72, "・負けた人も問題を出す役になる<br>・はんで答える", "くふうの意見", { size: 12 }),
      { k: "line", x1: 81.5, y1: 3, x2: 81.5, y2: 75, color: "#ffffff", width: 0.4, keep: true },
      keep("tanzaku", 25.8, 1.2, 4, 30, "決まったこと", { size: 11, color: "#d12a1e" }),
      v("waku", 27.2, 2.3, 4, 72, "クイズ大会と、ルールをかえたフルーツバスケット", "決まったこと（赤で囲む）", { size: 13, borderColor: "#ff9e94" }),
      keep("moji", 30.2, 1, 4, 40, "先生の話", { size: 11 }), keep("moji", 32, 1, 4, 40, "ふり返り", { size: 11 })
    ],
    notes: [
      ["はじめ（5分）", "・司会、黒板記録2人、ノート記録。計画委員会で板書の場所を決めておく<br>・議題、提案理由、めあて、決まっていることは、前の日に短冊で用意する"],
      ["話し合い（30分）", "・出し合う（8分）：短冊に書いて貼る。にた意見は近くに<br>・くらべ合う（15分）：賛成は◎、心配は△。人数は数字で<br>　「○○に賛成です。理由は〜」「〜が心配です。〜にかえたら？」<br>・まとめる（7分）：合わせられる意見がないかを先に聞く<br>・教師は、めあてからそれたときだけ入る"],
      ["おわり（10分）", "・決まったことを赤で囲む<br>・ふり返り：自分も友だちも楽しめる決め方だったか<br>・先生の話：よかった発言を名前を出してほめる"]
    ]
  });

  add({
    key: "gakkyu-hyo", subject: "学級会", name: "話し合い　二つの案を表でくらべる",
    note: "案が2つか3つにしぼれたときに。よい点と心配な点を表にして、新しい案へ進みます。教科の話し合いにも使えます。",
    head: "板書計画　　4年　学級活動　第6回学級会　　ねらい：二つの案のよい点と心配な点をくらべて、みんながなっとくできる案を作る。",
    dir: "v",
    items: [
      v("moji", 0, 1, 3, 50, "第六回　学級会", "第○回　学級会", { size: 12 }),
      keep("tanzaku", 1.3, 1.1, 4, 14, "議題", { size: 10 }), v("moji", 1.3, 1.1, 19, 58, "雨の日の遊びを決めよう", "議題", { size: 13 }),
      v("meate", 3.5, 1.8, 8, 66, "よい点と心配な点をくらべて決めよう。", "話し合いのめあて", { size: 13 }),
      { k: "line", x1: 70, y1: 6, x2: 70, y2: 74, keep: true }, { k: "line", x1: 226, y1: 6, x2: 226, y2: 74, keep: true },
      { k: "line", x1: 70, y1: 6, x2: 226, y2: 6, keep: true }, { k: "line", x1: 70, y1: 74, x2: 226, y2: 74, keep: true },
      { k: "line", x1: 70, y1: 22, x2: 226, y2: 22, keep: true }, { k: "line", x1: 70, y1: 48, x2: 226, y2: 48, keep: true },
      { k: "line", x1: 151, y1: 6, x2: 151, y2: 74, keep: true },
      keep("midashi", 6.4, 1, 24, 22, "よい点", S12), keep("midashi", 6.4, 1, 50, 22, "心配な点", S12),
      v("kakomi", 9, 1.4, 7.5, 13, "Ａ", "", { size: 13 }, { keep: true }), v("moji", 11, 1, 7.5, 14, "トランプ", "Ａ案", { size: 9 }),
      v("moji", 8, 4, 23, 24, "少人数でできる<br>しずかにできる", "よい点", { size: 10 }), v("moji", 8, 4, 49, 24, "入れない人が出る", "心配な点", { size: 10 }),
      v("kakomi", 19.6, 1.4, 7.5, 13, "Ｂ", "", { size: 13 }, { keep: true }), v("moji", 21.6, 1, 7.5, 14, "しりとり", "Ｂ案", { size: 9 }),
      v("moji", 18.6, 4, 23, 24, "全員でできる<br>もり上がる", "よい点", { size: 10 }), v("moji", 18.6, 4, 49, 24, "用意がいる<br>時間がかかる", "心配な点", { size: 10 }),
      keep("tanzaku", 28.6, 1.1, 4, 30, "決まったこと", { size: 11, color: "#d12a1e" }),
      v("waku", 29.9, 3, 4, 72, "曜日で分ける。月水金はトランプ、火木は全員でしりとり", "新しい案（C案）や、決まったこと", { size: 12, borderColor: "#ff9e94" })
    ],
    notes: [
      ["はじめ（5分）", "・前の時間に出た案を、AとBの2つにしぼっておく<br>・表のわくは、先にかいておく"],
      ["話し合い（30分）", "・「Aのよい点は？」「Bのよい点は？」を先に聞く（よい点から）<br>・心配な点には「どうすればなくせる？」を必ず返す<br>・「AとBを合わせられない？」→ C案へ"],
      ["おわり（10分）", "・決まったことを赤で囲む<br>・ふり返り"]
    ]
  });

  // ======================= 道徳（縦書き） =======================
  add({
    key: "dotoku-bamen", subject: "道徳", name: "道徳　右から場面を追う",
    note: "右から場面絵と子どもの言葉をならべ、まん中に中心の発問。左はしに「今日考えたこと」。心情を追う読み物の時間に。",
    head: "板書計画　　4年　道徳　「席をゆずる」（自作の話）　内容項目：親切、思いやり　　ねらい：相手の立場で考えて、進んで親切にしようとする心情を育てる。",
    dir: "v",
    items: [
      keep("moji", 0, 1, 3, 40, "○月○日（○）", { size: 9, lineHeight: 1.2 }),
      v("moji", 1, 1, 4, 50, "席をゆずる", "教材名"),
      v("meate", 2.6, 1.4, 8, 66, "親切にするとき、心の中で何が起きているのだろう。", "今日の問い", { size: 13, bandLabel: "問い" }),
      v("shiryo", 5.6, 3, 5, 26, "（場面絵①）<br>バスの中", "場面絵", { dir: "h", size: 8.5 }), v("moji", 5.6, 3, 34, 42, "立っている<br>おばあさんに<br>気づく", "場面①の出来事", S12),
      v("shiryo", 10, 3, 5, 26, "（場面絵②）<br>まよう", "場面絵", { dir: "h", size: 8.5 }),
      v("fuki", 10, 1.4, 34, 42, "ことわられそう", "子どもの言葉", { size: 11 }), v("fuki", 11.6, 1.4, 34, 42, "みんなが見ている", "子どもの言葉", { size: 11 }),
      v("tanzaku", 14.6, 1.6, 4, 72, "立ち上がったとき、どんなことを考えていただろう。", "中心の発問（赤で囲む）", { size: 13, borderColor: "#d12a1e" }),
      v("fuki", 16.8, 1.4, 5, 34, "こまっていそう", "子どもの言葉", { size: 11 }), v("fuki", 16.8, 1.4, 42, 34, "家族だったら", "子どもの言葉", { size: 11 }),
      v("fuki", 18.6, 1.4, 5, 34, "見ぬふりはいや", "子どもの言葉", { size: 11 }), v("fuki", 18.6, 1.4, 42, 34, "ドキドキする", "子どもの言葉", { size: 11 }),
      v("shiryo", 21, 3, 5, 26, "（場面絵③）<br>お礼の言葉", "場面絵", { dir: "h", size: 8.5 }), v("kiiro", 21, 3, 34, 42, "言ってよかった<br>心があたたかい", "そのときの気持ち", S12),
      v("matome", 30.2, 3.7, 8, 66, "相手の立場で考えると、一歩が出る。", "今日考えたこと", { size: 14, bandLabel: "今日考えたこと" })
    ],
    notes: [
      ["導入（5分）", "①「親切にしようと思ったのに、できなかったことは？」<br>　→ 経験を2、3人に聞く。責めない"],
      ["展開（30分）", "② 話を読む。場面絵を右から貼る<br>③「まよっているとき、心の中は？」→ 両方の気持ちを吹き出しに<br>④ 中心の発問「立ち上がったとき、どんなことを考えていた？」<br>　→ 問い返す「はずかしさは、なくなったの？」"],
      ["終末（10分）", "⑤「今日考えたこと」を書く<br>・教師の説話で価値をおしつけない"]
    ]
  });
})();

;
/* マス目プリントメーカー：板書計画の型のデータ（社会、総合、音楽、図工、道徳の横書き）
 * x、y は、黒板の左上からの mm。字の幅の目安：16pt は1字5.6mm、14pt は4.9mm、13pt は4.6mm、12pt は4.2mm。
 * 記入例は、どれも自作（教科書の文を写さない。曲名や作品名は出さない）。
 */
(function () {
  "use strict";
  var add = window.App.addKata;
  function p(k, x, y, w, hh, t, hint, o, more) { return Object.assign({ k: k, x: x, y: y, w: w, h: hh, t: t, hint: hint, o: o }, more || {}); }
  function keep(k, x, y, w, hh, t, o) { return { k: k, x: x, y: y, w: w, h: hh, t: t, keep: true, o: o }; }
  var S14 = { size: 14 }, S13 = { size: 13 }, S12 = { size: 12 }, G = "#86aa9c", Y = "#ffe066";
  function guide(x) { return { k: "line", x1: x, y1: 19, x2: x, y2: 75, color: G, width: 0.3, dash: "dash", keep: true }; }

  // ======================= 社会 =======================
  add({
    key: "shakai-kotoba", subject: "社会", name: "社会　資料は電子黒板、黒板は言葉",
    note: "いちばん上に学習問題を1行。下を、予想、分かったこと、考えとまとめに分けます。資料は貼らず、電子黒板に映した資料の名前だけを札で残します。",
    head: "板書計画　　4年　社会　「水はどこから」　本時 3／10　　ねらい：水がとどくまでの道すじと、そこで働く人のくふうを調べる。",
    items: [
      p("meate", 11, 3, 262, 12, "じゃ口の水は、どこから、どのようにして来るのだろう。", "学習問題（上に1行）", { bandLabel: "学習問題" }),
      guide(72), guide(200),
      keep("midashi", 11, 19, 30, 7, "予想"),
      p("moji", 11, 26, 58, 22, "・川から来る<br>・きれいにする所がある", "予想", S13),
      p("tanzaku", 11, 56, 56, 16, "電子黒板：<br>水の通り道の図", "電子黒板に映す資料の名前", { size: 11 }),
      keep("midashi", 76, 19, 50, 7, "分かったこと"),
      p("moji", 76, 27, 28, 9, "ダム", "①", S14), p("moji", 106, 27, 40, 9, "じょう水場", "②", S14), p("moji", 152, 27, 40, 9, "水道管 → 家", "③", S14),
      { k: "arrow", x1: 92, y1: 31.5, x2: 105, y2: 31.5, color: "#ffffff", only: "example" }, { k: "arrow", x1: 140, y1: 31.5, x2: 151, y2: 31.5, color: "#ffffff", only: "example" },
      p("moji", 76, 38, 120, 16, "・じょう水場で、ごみやばいきんを取る<br>・毎日、水を検査する人がいる", "調べて分かったこと（言葉で）", S13),
      p("kiiro", 76, 58, 120, 16, "24時間、交代で見守っている", "大事な言葉（黄色）", S14),
      keep("midashi", 204, 19, 30, 7, "考え"),
      p("fuki", 204, 26, 68, 17, "たくさんの人としせつが<br>つながっている", "子どもの考え", S12),
      p("matome", 204, 49, 69, 24, "水は、ダム、じょう水場、水道管を通り、安全にしてとどけられる。", "まとめ", { size: 13 })
    ],
    notes: [
      ["つかむ（10分）", "①「けさ使った水は、どこから来たのかな」<br>　→ 予想をノートに。2、3人に聞いて書く<br>・学習問題は単元を通して同じ。上に1行で"],
      ["調べる（25分）", "② 電子黒板に水の通り道の図を映す<br>③「じょう水場では、何をしている？」<br>　→ 教科書と資料集から言葉で見つける<br>④「だれが、いつ、はたらいている？」→ 24時間を黄色で<br>・資料は映すだけ。黒板には言葉をのこす"],
      ["まとめる（10分）", "⑤「学習問題に、今日の言葉で答えよう」<br>⑥ まとめを書く。次の時間の問いを1つ聞く"]
    ]
  });

  add({
    key: "shakai-tachiba", subject: "社会", name: "社会　立場で分ける",
    note: "上に問い。下を、立場ごとの3つのわくに分けます。話し合いの時間や、単元の終わりに。",
    head: "板書計画　　4年　社会　「自然災害からくらしを守る」　本時 7／10　　ねらい：水害へのそなえを、市や県、地域、家庭の立場から整理する。",
    items: [
      p("meate", 11, 3, 262, 12, "水害にそなえて、だれが、何をしているのだろう。", "問い（上に1行）", { bandLabel: "問い" }),
      p("waku", 11, 25, 84, 33, "・ハザードマップを作る<br>・ていぼうを高くする<br>・ひなん所を開く", "立場①がしていること", { size: 12, borderColor: "#ff9e94" }), keep("kakomi", 11, 17, 30, 7.5, "市や県", { size: 12, fill: "#2f5d50" }),
      p("waku", 99, 25, 84, 33, "・消防団の見回り<br>・ひなん訓練<br>・声をかけ合う", "立場②がしていること", { size: 12, borderColor: Y }), keep("kakomi", 99, 17, 30, 7.5, "地域", { size: 12, fill: "#2f5d50" }),
      p("waku", 187, 25, 86, 33, "・ひじょう持ち出しぶくろ<br>・ひなん場所を家族で決める", "立場③がしていること", { size: 12, borderColor: "#ffffff" }), keep("kakomi", 187, 17, 30, 7.5, "家庭", { size: 12, fill: "#2f5d50" }),
      p("kiiro", 11, 61, 120, 9, "どれか一つでは守れない", "立場をこえて言えること（黄色）", S14),
      p("matome", 138, 61, 135, 13, "市や県、地域、家庭が協力してそなえている。", "まとめ", { size: 13 })
    ],
    notes: [
      ["つかむ（8分）", "①「これまで調べたそなえを、だれがしているかで分けよう」"],
      ["話し合う（27分）", "② はんで付せんを3つの立場に分ける<br>③「自分の家でできているのは？」<br>④「市だけががんばれば守れる？」→ 守れない。なぜ？<br>・わくの色を変えて、立場を見分けやすくする"],
      ["まとめる（10分）", "⑤ まとめ<br>⑥「自分にできること」を1つノートに"]
    ]
  });

  add({
    key: "shakai-nagare", subject: "社会", name: "社会　流れ図でしくみをつかむ",
    note: "言葉を矢印でつないで、物や仕事の流れを見せます。ごみ、水、物がとどくまで、などに。",
    head: "板書計画　　4年　社会　「ごみのしょりと利用」　本時 4／10　　ねらい：もえるごみが処理されるまでの流れを調べる。",
    items: [
      p("meate", 11, 3, 262, 12, "もえるごみは、どこへ行き、どうなるのだろう。", "学習問題（上に1行）", { bandLabel: "学習問題" }),
      p("kakomi", 14, 24, 40, 11, "家のごみ", "はじめ", { borderColor: "#ffffff" }), { k: "arrow", x1: 55, y1: 29.5, x2: 66, y2: 29.5, keep: true },
      p("kakomi", 67, 24, 40, 11, "しゅう集車", "つぎ", { borderColor: "#ffffff" }), { k: "arrow", x1: 108, y1: 29.5, x2: 119, y2: 29.5, keep: true },
      p("kakomi", 120, 24, 46, 11, "せいそう工場", "つぎ", { borderColor: Y }), { k: "arrow", x1: 167, y1: 29.5, x2: 178, y2: 29.5, keep: true },
      p("kakomi", 179, 24, 30, 11, "はい", "つぎ", { borderColor: "#ffffff" }), { k: "arrow", x1: 210, y1: 29.5, x2: 221, y2: 29.5, keep: true },
      p("kakomi", 222, 24, 50, 11, "うめ立て場", "おわり", { borderColor: "#ff9e94" }),
      p("moji", 60, 38, 56, 14, "決まった曜日に<br>地区ごとに回る", "そこでのくふう", S12), p("moji", 120, 38, 56, 14, "高い温度でもやす<br>熱で電気を作る", "そこでのくふう", S12), p("moji", 222, 38, 52, 14, "あと○年で<br>いっぱいになる", "そこでの問題（市の資料の数字を入れる）", { size: 12, color: "#ff9e94" }),
      p("fuki", 14, 58, 100, 16, "もやすと、かさが小さくなるんだ", "子どもの気づき", S12),
      p("matome", 138, 55, 135, 19, "ごみは工場でもやされ、はいはうめ立て場に運ばれる。<br>うめ立て場には、かぎりがある。", "まとめ", { size: 12 })
    ],
    notes: [
      ["つかむ（8分）", "①「ごみ出しのあと、ごみはどこへ？」"],
      ["調べる（27分）", "② 電子黒板に工場の写真。流れを言葉でつなぐ<br>③「なぜ、もやすの？」→ かさをへらす<br>④「はいは、どこへ？」→ うめ立て場。あと何年使える？"],
      ["まとめる（10分）", "⑤ まとめ<br>⑥ 次の時間の問い「ごみをへらすには？」"]
    ]
  });

  // ======================= 総合的な学習の時間 =======================
  add({
    key: "sogo-web", subject: "総合", name: "総合　まん中から広げる（ウェビング）",
    note: "まん中にテーマ。まわりに子どもの言葉を線でつなぎ、同じ仲間を色で囲みます。いちばん下に、みんなの課題を1行。",
    head: "板書計画　　4年　総合的な学習の時間　「○○川を調べよう」　本時 2／30　　ねらい：川について知っていることや疑問を出し合い、みんなの課題を決める。",
    items: [
      p("kakomi", 118, 27, 44, 13, "○○川", "テーマ", { size: 18 }),
      p("fuki", 20, 5, 62, 10, "ごみがういていた", "子どもの言葉", S12), p("fuki", 20, 19, 62, 10, "水がにごっている", "子どもの言葉", S12),
      p("fuki", 196, 5, 70, 10, "昔は泳げたらしい", "子どもの言葉", S12), p("fuki", 196, 19, 70, 10, "おじいちゃんに聞いた", "子どもの言葉", S12),
      p("fuki", 20, 42, 62, 10, "魚は何びきいる？", "子どもの言葉", S12), p("fuki", 196, 42, 70, 10, "大雨でふえてこわい", "子どもの言葉", S12),
      p("pink", 86, 8, 28, 8, "よごれ", "仲間の名前", S13), p("kiiro", 166, 8, 28, 8, "昔と今", "仲間の名前", S13), p("moji", 86, 44, 28, 8, "生き物", "仲間の名前", S13), p("moji", 166, 44, 28, 8, "水害", "仲間の名前", S13),
      { k: "line", x1: 118, y1: 30, x2: 83, y2: 14, keep: true }, { k: "line", x1: 162, y1: 30, x2: 195, y2: 14, keep: true },
      { k: "line", x1: 118, y1: 38, x2: 83, y2: 46, keep: true }, { k: "line", x1: 162, y1: 38, x2: 195, y2: 46, keep: true },
      p("meate", 11, 60, 262, 13, "○○川は、昔とくらべて、どうかわったのだろう。", "みんなの課題（下に1行）", { bandLabel: "みんなの課題" })
    ],
    notes: [
      ["出し合う（15分）", "①「○○川と聞いて、思いうかぶことは？」<br>　→ まん中から線でつなぐ。出た順に書く"],
      ["仲間に分ける（20分）", "②「にているものは、どれとどれ？」→ 色チョークで囲む<br>③「仲間に名前をつけよう」<br>④「いちばん調べたいのは？」→ 人数を聞く"],
      ["課題を決める（10分）", "⑤ みんなの課題を1行で<br>⑥「だれに聞けば分かる？」→ 次の時間へ"]
    ]
  });

  add({
    key: "sogo-nakama", subject: "総合", name: "総合　仲間に分けて整理する",
    note: "上に問い。下に、名前のついた3つのわく。調べたことの短冊を貼って、分けます。",
    head: "板書計画　　4年　総合的な学習の時間　「だれもがくらしやすい町」　本時 12／30　　ねらい：町で見つけたくふうを仲間に分けて、調べる課題をしぼる。",
    items: [
      p("meate", 11, 3, 262, 12, "町で見つけたくふうは、だれのためのものだろう。", "今日の問い", { bandLabel: "問い" }),
      { k: "rect", x: 11, y: 22, w: 84, h: 40, color: Y }, keep("kakomi", 14, 18.5, 46, 7.5, "目の不自由な人", { size: 12, fill: "#2f5d50" }),
      p("tanzaku", 15, 29, 36, 8, "点字ブロック", "短冊", { size: 11 }), p("tanzaku", 55, 29, 36, 8, "音の出る信号", "短冊", { size: 11 }), p("tanzaku", 15, 41, 50, 8, "シャンプーのぎざぎざ", "短冊", { size: 11 }),
      { k: "rect", x: 99, y: 22, w: 84, h: 40, color: "#ff9e94" }, keep("kakomi", 102, 18.5, 46, 7.5, "車いすの人", { size: 12, fill: "#2f5d50" }),
      p("tanzaku", 103, 29, 36, 8, "スロープ", "短冊", { size: 11 }), p("tanzaku", 143, 29, 36, 8, "低いボタン", "短冊", { size: 11 }),
      { k: "rect", x: 187, y: 22, w: 86, h: 40 }, keep("kakomi", 190, 18.5, 46, 7.5, "みんな", { size: 12, fill: "#2f5d50" }),
      p("tanzaku", 191, 29, 36, 8, "絵の案内", "短冊", { size: 11 }), p("tanzaku", 231, 29, 38, 8, "広い通路", "短冊", { size: 11 }),
      p("kiiro", 11, 65, 262, 9, "こまっている人のためのくふうは、みんなにも使いやすい", "分けて気づいたこと（黄色）", S14)
    ],
    notes: [
      ["出し合う（10分）", "① 町たんけんで見つけたくふうを、短冊に書いて貼る"],
      ["分ける（25分）", "②「だれのためのくふう？」→ わくに動かす<br>③「どちらにも入るものは？」→ わくの間に置く<br>④「分けてみて、気づいたことは？」"],
      ["しぼる（10分）", "⑤ 調べたいものを1つえらぶ<br>⑥ インタビューの質問を3つ考える"]
    ]
  });

  // ======================= 音楽 =======================
  add({
    key: "ongaku-kansho", subject: "音楽", name: "音楽　きき取ったことと、感じ取ったこと（鑑賞）",
    note: "左にめあて。まん中に「きき取ったこと」、右に「感じ取ったこと」をならべて、矢印でつなぎます。",
    head: "板書計画　　4年　音楽　鑑賞「3拍子の曲と2拍子の曲」　本時 1／2　　ねらい：拍子や旋律のちがいをきき取り、曲の感じとのかかわりを考える。",
    split: 3,
    items: [
      { k: "meate", z: 0, r: 0, h: 19, t: "曲のよさを見つけて、<br>音楽の言葉でつたえよう。", hint: "めあて" },
      { k: "midashi", z: 0, y: 27, w: 60, t: "音楽の言葉", keep: true },
      { k: "tanzaku", z: 0, y: 34, w: 24, h: 8, t: "拍子", hint: "札", o: { size: 11, align: "center" } }, { k: "tanzaku", z: 0, y: 34, x: 27, w: 24, h: 8, t: "旋律", hint: "札", o: { size: 11, align: "center" } }, { k: "tanzaku", z: 0, y: 34, x: 54, w: 24, h: 8, t: "速さ", hint: "札", o: { size: 11, align: "center" } },
      { k: "tanzaku", z: 0, y: 45, w: 24, h: 8, t: "強弱", hint: "札", o: { size: 11, align: "center" } }, { k: "tanzaku", z: 0, y: 45, x: 27, w: 24, h: 8, t: "音色", hint: "札", o: { size: 11, align: "center" } }, { k: "tanzaku", z: 0, y: 45, x: 54, w: 24, h: 8, t: "くり返し", hint: "札", o: { size: 11, align: "center" } },
      { k: "midashi", z: 1, r: 0, w: 60, t: "きき取ったこと", keep: true },
      { k: "moji", z: 1, y: 11, rows: 2, o: S13, t: "A　音が高くて長い<br>　　1、2、3でゆれる", hint: "1曲めで、きき取ったこと" },
      { k: "moji", z: 1, y: 40, rows: 2, o: S13, t: "B　短い音が多い<br>　　1、2で進む", hint: "2曲めで、きき取ったこと" },
      { k: "midashi", z: 2, r: 0, w: 60, t: "感じ取ったこと", keep: true },
      { k: "kiiro", z: 2, y: 11, rows: 2, o: S13, t: "なめらか<br>おどっているみたい", hint: "1曲めで、感じ取ったこと" },
      { k: "kiiro", z: 2, y: 40, rows: 2, o: S13, t: "にぎやか<br>行進しているみたい", hint: "2曲めで、感じ取ったこと" },
      { k: "arrow", x1: 170, y1: 17, x2: 187, y2: 17, color: "#ffffff", keep: true }, { k: "arrow", x1: 170, y1: 46, x2: 187, y2: 46, color: "#ffffff", keep: true },
      { k: "matome", z: 2, y: 59, h: 15, o: { size: 12 }, t: "拍子や音の長さで、曲の感じがかわる。", hint: "まとめ" }
    ],
    notes: [
      ["つかむ（8分）", "① 2曲を少しずつ聴く。「どんな感じ？」<br>　→ 感じた言葉を右に書く"],
      ["聴き深める（27分）", "②「なめらかに感じたのは、音がどうなっていたから？」<br>　→ きき取ったことをまん中に。矢印でつなぐ<br>③ 音楽の言葉の札を指して「どれのこと？」<br>・体を動かして拍子をたしかめる"],
      ["まとめる（10分）", "④ すきな曲をえらび、よさを「〜だから、〜な感じ」で書く"]
    ]
  });

  add({
    key: "ongaku-tsukuru", subject: "音楽", name: "音楽　音楽づくり（つくり方のやくそくと、できた音楽）",
    note: "左にめあてと、つくるときのやくそく。まん中に、拍のわく（ここに音のカードを置く）。右に、くふうの言葉とふり返り。",
    head: "板書計画　　4年　音楽　音楽づくり「打楽器で、始め、中、終わりのある音楽」　本時 3／5　　ねらい：音の重ね方やつなげ方をくふうして、「中」の部分をつくる。",
    split: 3,
    items: [
      { k: "meate", z: 0, r: 0, h: 19, t: "音の重ね方とつなげ方を<br>くふうして「中」をつくろう。", hint: "めあて", o: { size: 14 } },
      { k: "midashi", z: 0, y: 27, w: 60, t: "やくそく", keep: true },
      { k: "moji", z: 0, y: 34, rows: 3, o: S13, t: "①8拍を2回<br>②楽器は3つまで<br>③休みを1つ入れる", hint: "つくるときのやくそく" },
      { k: "midashi", z: 1, r: 0, w: 60, t: "拍のわく", keep: true },
      { k: "shiryo", z: 1, y: 11, w: 86, h: 26, t: "1　2　3　4　5　6　7　8<br>（音のカードを置く）", hint: "拍のわく（カードを置く）" },
      { k: "moji", z: 1, y: 41, rows: 2, o: S13, t: "木の楽器 → みんなで重ねる<br>→ だんだん小さく", hint: "できた音楽の組み立て" },
      { k: "midashi", z: 2, r: 0, w: 60, t: "くふうの言葉", keep: true },
      { k: "fuki", z: 2, y: 11, w: 80, h: 12, t: "木の楽器だけでまとまりを出した", hint: "子どもの言葉", o: S12 },
      { k: "fuki", z: 2, y: 26, w: 80, h: 12, t: "くり返してから、重ねた", hint: "子どもの言葉", o: S12 },
      { k: "kiiro", z: 2, y: 42, rows: 1, o: S14, t: "重ねる　つなげる　くり返す", hint: "音楽の言葉（黄色）" },
      { k: "furikaeri", z: 2, y: 55, w: 84, h: 18, t: "ふり返り：重ねると、つなげるで、感じはどうかわった？", hint: "ふり返り" }
    ],
    notes: [
      ["つかむ（8分）", "① 前の時間の「始め」を聴く。「中は、どうしたい？」<br>② やくそくをたしかめる"],
      ["つくる（27分）", "③ はんでつくる。とちゅうで1つのはんを聴く<br>④「今のはんのくふうは？」→ 吹き出しで残す<br>・音を出す時間と、話し合う時間を分ける"],
      ["聴き合う（10分）", "⑤ 2つのはんを聴き合う<br>⑥ ふり返りを書く"]
    ]
  });

  add({
    key: "ongaku-utau", subject: "音楽", name: "音楽　歌唱（拡大楽譜に書きこむ）",
    note: "まん中に拡大楽譜を貼り、強弱や気をつける所を書きこみます。左にめあてと第一印象、右に思いをこめたい所。",
    head: "板書計画　　4年　音楽　歌唱「日本の歌」　本時 2／3　　ねらい：旋律の動きや強弱に気をつけて、情景を思いうかべながら歌う。",
    split: 3,
    items: [
      { k: "meate", z: 0, r: 0, h: 19, t: "強弱と旋律の動きに<br>気をつけて歌おう。", hint: "めあて" },
      { k: "midashi", z: 0, y: 27, w: 60, t: "聴いた感じ", keep: true },
      { k: "fuki", z: 0, y: 34, x: 2, w: 72, h: 11, t: "しずかで、広い感じ", hint: "第一印象", o: S12 }, { k: "fuki", z: 0, y: 48, x: 2, w: 72, h: 11, t: "夕方の景色がうかぶ", hint: "第一印象", o: S12 },
      { k: "shiryo", z: 1, r: 0, w: 86, h: 40, t: "（拡大楽譜を貼る）", hint: "拡大楽譜を貼る" },
      { k: "kiiro", z: 1, y: 47, rows: 2, o: S13, t: "3段め　だんだん強く<br>音が上がる → 山", hint: "楽譜から見つけたこと" },
      { k: "midashi", z: 2, r: 0, w: 70, t: "思いをこめたい所", keep: true },
      { k: "moji", z: 2, y: 11, rows: 2, o: S13, t: "いちばん高い音<br>　→ 遠くへとどける声で", hint: "思いをこめたい所と、歌い方" },
      { k: "moji", z: 2, y: 30, rows: 2, o: S13, t: "さいごの音が下がる所<br>　→ しみじみと、やさしく", hint: "思いをこめたい所と、歌い方" },
      { k: "furikaeri", z: 2, y: 55, w: 84, h: 18, t: "ふり返り：どこを、どのように歌った？", hint: "ふり返り" }
    ],
    notes: [
      ["つかむ（8分）", "① 範唱を聴く。「どんな感じ？ どんな景色？」"],
      ["歌い深める（27分）", "②「その感じは、楽譜のどこから？」→ 楽譜に印<br>③「だんだん強く」を、強くしないで歌ってくらべる<br>④ 思いをこめたい所をえらんで、歌い方を決める"],
      ["まとめる（10分）", "⑤ 通して歌う。録音して聴く<br>⑥ ふり返りを書く"]
    ]
  });

  // ======================= 図画工作 =======================
  add({
    key: "zuko-nagare", subject: "図工", name: "図工　めあて、活動の流れ、やくそく",
    note: "はじめに全部書いておき、作っている間も消しません。左にめあて、まん中に流れとヒント、右に安全のやくそくと時間。",
    head: "板書計画　　4年　図画工作　「切った木から思いついて」　本時 2／6　　ねらい：のこぎりで切った木の形や組み合わせから、表したいものを思いつく。",
    split: 3,
    items: [
      { k: "moji", z: 0, r: 0, t: "切った木から思いついて", hint: "題材の名前" },
      { k: "meate", z: 0, y: 14, h: 19, t: "木の形や組み合わせから<br>思いついたものを作ろう。", hint: "めあて", o: { size: 14 } },
      { k: "fuki", z: 0, y: 40, x: 2, w: 72, h: 11, t: "ななめに切ると屋根みたい", hint: "子どものつぶやき", o: S12 }, { k: "fuki", z: 0, y: 54, x: 2, w: 72, h: 11, t: "重ねると階だんになる", hint: "子どものつぶやき", o: S12 },
      { k: "midashi", z: 1, r: 0, w: 60, t: "活動の流れ", keep: true },
      { k: "moji", z: 1, y: 11, rows: 4, o: S13, t: "①切る（長さをかえて）<br>②ならべる、組み合わせる<br>③思いついたら、つける<br>④かたづけ（○時○分）", hint: "活動の流れ" },
      { k: "shiryo", z: 1, y: 46, w: 86, h: 27, t: "（参考作品や、組み合わせの写真を貼る）", hint: "参考作品を貼る" },
      { k: "waku", z: 2, r: 0, w: 84, h: 44, o: { size: 13, borderColor: "#ff9e94" }, t: "安全のやくそく<br>・木をしっかりおさえる<br>・切る先に手を置かない<br>・持って歩くときは、はを下に", hint: "安全のやくそく" },
      { k: "kiiro", z: 2, y: 50, rows: 1, o: S14, t: "○時○分まで", hint: "終わりの時こく" },
      { k: "furikaeri", z: 2, y: 59, w: 84, h: 15, t: "ふり返り：形から何を思いついた？", hint: "ふり返り" }
    ],
    notes: [
      ["導入（10分）", "① 切った木を見せる。「何に見える？」<br>② のこぎりのやくそくをたしかめる（実演）"],
      ["活動（65分）", "③ 切る → ならべる → つける<br>④ とちゅうで手を止めて、友だちの作品を見る（5分）<br>・やくそくは消さない。時こくを書いておく"],
      ["ふり返り（15分）", "⑤ 作品をならべて見合う<br>⑥ ふり返りを書く。かたづけ"]
    ]
  });

  add({
    key: "zuko-kansho", subject: "図工", name: "図工　鑑賞（見る視点の札）",
    note: "まん中に作品を貼り、そばに「色」「形」「動き」などの札を置いて、子どもの言葉を書きます。中間鑑賞にも。",
    head: "板書計画　　4年　図画工作　鑑賞「友だちの作品のよさを見つけよう」　本時 6／6　　ねらい：色、形、表し方に目を向けて、作品のよさやおもしろさを感じ取る。",
    split: 3,
    items: [
      { k: "meate", z: 0, r: 0, h: 19, t: "友だちの作品のよさを<br>見つけてつたえよう。", hint: "めあて" },
      { k: "midashi", z: 0, y: 27, w: 60, t: "見る視点", keep: true },
      { k: "tanzaku", z: 0, y: 34, w: 24, h: 8, t: "色", hint: "札", o: { size: 11, align: "center" } }, { k: "tanzaku", z: 0, y: 34, x: 27, w: 24, h: 8, t: "形", hint: "札", o: { size: 11, align: "center" } }, { k: "tanzaku", z: 0, y: 34, x: 54, w: 24, h: 8, t: "動き", hint: "札", o: { size: 11, align: "center" } },
      { k: "tanzaku", z: 0, y: 45, w: 38, h: 8, t: "組み合わせ", hint: "札", o: { size: 11, align: "center" } }, { k: "tanzaku", z: 0, y: 45, x: 41, w: 37, h: 8, t: "表したい思い", hint: "札", o: { size: 11, align: "center" } },
      { k: "shiryo", z: 1, r: 0, w: 86, h: 40, t: "（作品か、作品の写真を貼る）", hint: "作品を貼る" },
      { k: "kiiro", z: 1, y: 47, rows: 2, o: S13, t: "色：明るい色でうれしさが出ている<br>形：長い木で高さを出している", hint: "札ごとに、子どもの言葉" },
      { k: "midashi", z: 2, r: 0, w: 60, t: "つたえ方", keep: true },
      { k: "kakomi", z: 2, y: 11, w: 84, h: 20, o: { size: 13, align: "start" }, t: "〜のところが、〜でいいね。<br>わたしは〜と感じたよ。", hint: "つたえ方の型" },
      { k: "fuki", z: 2, y: 36, w: 80, h: 12, t: "いろんな人がいて、にぎやか", hint: "子どもの言葉", o: S12 },
      { k: "furikaeri", z: 2, y: 55, w: 84, h: 18, t: "ふり返り：友だちの作品から、まねしたいことは？", hint: "ふり返り" }
    ],
    notes: [
      ["つかむ（8分）", "① 1つの作品をみんなで見る。「どこがいい？」<br>　→ 出た言葉を、視点の札の下に分けて書く"],
      ["見合う（27分）", "② 作品を自由に見て回る。カードに書いて置く<br>③「作った人に聞いてみたいことは？」"],
      ["まとめる（10分）", "④ もらったカードを読む<br>⑤ ふり返りを書く"]
    ]
  });

  // ======================= 道徳（横書き） =======================
  add({
    key: "dotoku-taihi", subject: "道徳", name: "道徳　左右でくらべる（まよう気持ち）",
    note: "左右に2つの立場を置き、間に両向きの矢印。名前のマグネットで自分の立場をしめします。下で1つにまとめます。",
    head: "板書計画　　4年　道徳　「やくそく」（自作の話）　内容項目：正直、誠実　　ねらい：自分の心に正直に行動しようとする判断力を育てる。",
    items: [
      p("moji", 11, 3, 60, 8, "やくそく", "教材名"),
      p("tanzaku", 80, 3, 190, 10, "自分なら、どちらをえらぶだろう。それはなぜだろう。", "中心の発問", { size: 14, borderColor: "#d12a1e" }),
      p("kakomi", 14, 18, 100, 10, "友だちとのやくそくを守る", "立場A", { size: 14, borderColor: "#ffffff" }), p("kakomi", 172, 18, 100, 10, "自分のしたいことをする", "立場B", { size: 14, borderColor: "#ffffff" }),
      { k: "arrow", x1: 118, y1: 23, x2: 168, y2: 23, color: Y, keep: true }, { k: "arrow", x1: 168, y1: 23, x2: 118, y2: 23, color: Y, keep: true },
      p("shiryo", 126, 27, 34, 12, "名前の<br>マグネット", "名前のマグネットを置く線", { size: 9 }),
      p("fuki", 14, 30.5, 100, 10, "やくそくは先にしたから", "子どもの言葉", S12), p("fuki", 14, 42, 100, 10, "あとで自分がくやむ", "子どもの言葉", S12),
      p("fuki", 172, 30.5, 100, 10, "めったにないチャンスだから", "子どもの言葉", S12), p("fuki", 172, 42, 100, 10, "あやまればゆるしてくれる", "子どもの言葉", S12),
      p("kiiro", 60, 53.5, 170, 8, "どちらをえらんでも、自分の心にうそはつけない", "2つの立場に同じところ（黄色）", S14),
      p("matome", 40, 63, 200, 8, "自分の心に正直にえらぶ。", "今日考えたこと", { size: 13, bandLabel: "今日考えたこと" })
    ],
    notes: [
      ["導入（5分）", "①「やくそくを守れなかったことは、ある？」→ 2、3人に聞く"],
      ["展開（30分）", "② 話を読む。「自分ならどちら？」名前のマグネットを置く<br>③ 理由を聞いて、左右に書く<br>④「相手の気持ちを聞いて、動かしたい人は？」→ 動かしてよい<br>⑤「どちらの人にも同じ気持ちは？」"],
      ["終末（10分）", "⑥「今日考えたこと」を書く。数人が読む"]
    ]
  });
})();

;
/* マス目プリントメーカー：英語の4線（英習罫）
 * 上から 第1線・第2線・第3線（基線）・第4線。線の間かくは、小学校の英語の教科書と同じ 5：6：5 が既定。
 * 字を入れると、基線にのり、小文字の高さ（x の高さ）が第2線にとどく大きさに、自動で決める。
 * app-render.js と app-panel.js のあとに読みこむ。
 */
(function () {
  "use strict";
  var App = window.App, h = App.h, s = App.s;
  var RATIOS = { "565": [5, 6, 5], "111": [1, 1, 1] };
  var BASE_COLORS = [["赤", "#d8574c"], ["青", "#4f86c6"], ["緑", "#5fa97c"], ["灰", "#8a8f96"], ["黒", "#1b1b1b"]];
  var LINE_COLORS = [["灰", "#9b9fa6"], ["青", "#8db4dd"], ["緑", "#9fcbaf"], ["黒", "#2a2a2a"]];

  App.TYPE_NAMES.eisen = "英語の4線";
  App.make.eisen = function (o) {
    return Object.assign({
      id: App.uid(), type: "eisen", x: 15, y: 30, w: 180, rows: 6, rowH: 14, gap: 9, ratio: "565",
      baseColor: "#d8574c", lineColor: "#9b9fa6", dash2: true, text: "", color: "#1b1b1b", font: "kyokasho"
    }, o || {});
  };
  App.eisenHeight = function (b) { return b.rows * b.rowH + (b.rows - 1) * b.gap; };

  // ---------- 字の大きさを、4線に合わせて決める ----------
  var metricsCache = {};
  /** その書体の、x の高さ、h の高さ、p の下がり（字の大きさ1に対する割合）と、
   *  ブラウザが行の中で字を置くときに使う、書体そのものの上と下の高さ（fbA、fbD）。 */
  function metrics(fontCss) {
    if (metricsCache[fontCss]) return metricsCache[fontCss];
    var cv = document.createElement("canvas").getContext("2d");
    cv.font = "200px " + fontCss;
    var x = cv.measureText("x"), hh = cv.measureText("h"), p = cv.measureText("p");
    var m = { x: (x.actualBoundingBoxAscent || 96) / 200, asc: (hh.actualBoundingBoxAscent || 144) / 200, desc: (p.actualBoundingBoxDescent || 44) / 200,
      fbA: (hh.fontBoundingBoxAscent || 200) / 200, fbD: (hh.fontBoundingBoxDescent || 60) / 200 };
    if (document.fonts && document.fonts.status === "loaded") metricsCache[fontCss] = m;
    return m;
  }

  /** 段の形。y0 が上の線、y2 が基線（第3線）、fs が字の大きさ（mm）。 */
  function rowGeom(b, i) {
    var r = RATIOS[b.ratio] || RATIOS["565"], sum = r[0] + r[1] + r[2], m = metrics(App.fontCss(b.font));
    var y0 = i * (b.rowH + b.gap), xH = b.rowH * r[1] / sum, fs = xH / (m.x || 0.48);
    return { y0: y0, y1: y0 + b.rowH * r[0] / sum, y2: y0 + b.rowH * (r[0] + r[1]) / sum, y3: y0 + b.rowH, fs: fs, m: m };
  }

  /** 紙の上で字を打つ段。段ごとに、そのまま打てる小さな入れ物（contenteditable）を 4線の上に置く。
   *  基線（第3線）に字がのるように、入れ物の上の位置を書体の高さから計算する。 */
  function fillEisen(el, b) {
    el.innerHTML = "";
    var H = App.eisenHeight(b), W = b.w;
    b.h = H;
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", height: "100%", preserveAspectRatio: "none", style: "display:block;overflow:visible" });
    var fcss = App.fontCss(b.font), lines = String(b.text || "").split("\n");
    for (var i = 0; i < b.rows; i++) {
      var g = rowGeom(b, i);
      svg.appendChild(s("line", { x1: 0, y1: g.y0, x2: W, y2: g.y0, stroke: b.lineColor, "stroke-width": 0.25 }));
      svg.appendChild(s("line", { x1: 0, y1: g.y1, x2: W, y2: g.y1, stroke: b.lineColor, "stroke-width": 0.25, "stroke-dasharray": b.dash2 ? "1.2 1.2" : null }));
      svg.appendChild(s("line", { x1: 0, y1: g.y2, x2: W, y2: g.y2, stroke: b.baseColor, "stroke-width": 0.45 }));
      svg.appendChild(s("line", { x1: 0, y1: g.y3, x2: W, y2: g.y3, stroke: b.lineColor, "stroke-width": 0.25 }));
      // 字の入れ物：行の高さを rowH にして、基線が y2 に来る位置に置く
      var L = b.rowH, top = g.y2 - L / 2 + (g.m.fbD - g.m.fbA) * g.fs / 2;
      var fo = s("foreignObject", { x: 3, y: top, width: W - 3, height: L });
      var div = document.createElement("div");
      div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      div.className = "el";
      div.setAttribute("data-row", i);
      div.setAttribute("spellcheck", "false");
      div.style.cssText = "font-family:" + fcss + ";font-size:" + g.fs + "px;line-height:" + L + "px;height:" + L + "px;color:" + b.color + ";white-space:pre;overflow:visible;outline:none;margin:0;padding:0";
      div.textContent = lines[i] || "";
      fo.appendChild(div);
      svg.appendChild(fo);
    }
    el.appendChild(svg);
  }

  var fill0 = App.fillBlock;
  App.fillBlock = function (el, b) {
    if (b.type === "eisen") { fillEisen(el, b); App.placeBlock(el, b); return; }
    fill0(el, b);
  };

  // ---------- 紙の上で打つ ----------
  function rowsOf(b) { return Array.prototype.slice.call(App.blockEl(b.id).querySelectorAll(".el")); }
  function readRows(b) { b.text = rowsOf(b).map(function (d) { return d.textContent.replace(/\n/g, ""); }).join("\n").replace(/\n+$/, ""); }
  function caretTo(div, pos) {
    div.focus({ preventScroll: true });
    var sel = window.getSelection(), range = document.createRange(), node = div.firstChild;
    if (!node) { range.setStart(div, 0); } else { range.setStart(node, Math.max(0, Math.min(pos, node.length))); }
    range.collapse(true); sel.removeAllRanges(); sel.addRange(range);
  }
  function caretPos(div) {
    var sel = window.getSelection();
    if (!sel.rangeCount || !div.contains(sel.anchorNode)) return div.textContent.length;
    return sel.anchorNode === div ? div.textContent.length : sel.anchorOffset;
  }
  /** 段の幅をこえた字を、次の段へ送る（単語のとちゅうでは切らない）。送ったら true。 */
  function flow(b, i) {
    var rows = rowsOf(b), d = rows[i];
    if (!d || d.scrollWidth <= d.clientWidth + 1) return false;
    var t = d.textContent, cut = -1;
    // 入りきる長さを、うしろから探す（空白の所で切る）
    for (var k = t.length - 1; k > 0; k--) {
      if (t[k] !== " ") continue;
      d.textContent = t.slice(0, k);
      if (d.scrollWidth <= d.clientWidth + 1) { cut = k; break; }
    }
    if (cut < 0) { d.textContent = t; return false; }   // 1語が段より長い。そのままにする
    var rest = t.slice(cut + 1);
    if (i + 1 >= rows.length) { d.textContent = t; App.toast("段が足りません。「段の数」をふやすと、続きが入ります。", 4000); return false; }
    var next = rows[i + 1];
    next.textContent = rest + (next.textContent ? " " + next.textContent : "");
    return true;
  }
  App.startEisenEdit = function (b, ev) {
    App.stopEditing();
    App.selId = b.id;
    App.edit = { id: b.id, type: "eisen" };
    var rows = rowsOf(b), div = null, pos = 0;
    if (ev) {
      var hit = document.elementFromPoint(ev.clientX, ev.clientY), inRow = hit && hit.closest && hit.closest(".el");
      if (inRow) { div = inRow; var r = document.caretRangeFromPoint && document.caretRangeFromPoint(ev.clientX, ev.clientY); pos = r && div.contains(r.startContainer) ? r.startOffset : div.textContent.length; }
      else {
        // 段と段の間や、右の空いた所を押したときは、いちばん近い段
        var el = App.blockEl(b.id), rc = el.getBoundingClientRect(), yy = (ev.clientY - rc.top) / rc.height * App.eisenHeight(b), best = 1e9;
        rows.forEach(function (d, i) { var g = rowGeom(b, i), c = (g.y0 + g.y3) / 2; if (Math.abs(c - yy) < best) { best = Math.abs(c - yy); div = d; } });
        pos = div ? div.textContent.length : 0;
      }
    }
    if (!div) { div = rows[0]; pos = div.textContent.length; }
    rows.forEach(function (d) { d.contentEditable = "true"; });
    caretTo(div, pos);
    App.drawSelection();
    App.renderPanel();
  };
  var stop0 = App.stopEditing;
  App.stopEditing = function () {
    var e = App.edit;
    if (e && e.type === "eisen") {
      App.edit = null;
      var f = App.find(e.id);
      if (f) {
        readRows(f.block);
        rowsOf(f.block).forEach(function (d) { d.contentEditable = "false"; d.blur(); });
        var sel = window.getSelection(); if (sel) sel.removeAllRanges();
        var ta = document.querySelector("#panel .eisen-text"); if (ta) ta.value = f.block.text;
      }
      App.commit();
      App.drawSelection();
      return;
    }
    stop0.apply(App, arguments);
  };
  document.addEventListener("input", function (ev) {
    var d = ev.target;
    if (!(d.classList && d.classList.contains("el")) || !App.edit || App.edit.type !== "eisen") return;
    var f = App.find(App.edit.id); if (!f) return;
    var b = f.block, i = +d.dataset.row, pos = caretPos(d), len = d.textContent.length;
    if (flow(b, i)) {
      // 送ったあと、カーソルが送った字の中にあったなら、次の段へ移す
      var rows = rowsOf(b), moved = len - rows[i].textContent.length;
      if (pos > rows[i].textContent.length) caretTo(rows[i + 1], Math.max(0, pos - rows[i].textContent.length - 1));
      else caretTo(rows[i], Math.min(pos, rows[i].textContent.length));
      for (var k = i + 1; k < rows.length - 1 && flow(b, k); k++) {}
    }
    readRows(b);
    var ta = document.querySelector("#panel .eisen-text"); if (ta) ta.value = b.text;
    App.commit("eisen:" + b.id);
  }, true);
  document.addEventListener("keydown", function (ev) {
    var d = ev.target;
    if (!(d.classList && d.classList.contains("el")) || !App.edit || App.edit.type !== "eisen") return;
    var f = App.find(App.edit.id); if (!f) return;
    var rows = rowsOf(f.block), i = +d.dataset.row;
    if (ev.key === "Enter" || ev.key === "ArrowDown") { ev.preventDefault(); if (rows[i + 1]) caretTo(rows[i + 1], ev.key === "Enter" ? 0 : Math.min(caretPos(d), rows[i + 1].textContent.length)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); if (rows[i - 1]) caretTo(rows[i - 1], Math.min(caretPos(d), rows[i - 1].textContent.length)); }
    else if (ev.key === "Backspace" && caretPos(d) === 0 && rows[i - 1]) { ev.preventDefault(); var prev = rows[i - 1], at = prev.textContent.length; prev.textContent = prev.textContent + d.textContent; d.textContent = ""; caretTo(prev, at); readRows(f.block); App.commit("eisen:" + f.block.id); }
    else if (ev.key === "Escape") { ev.preventDefault(); App.stopEditing(); App.renderPanel(); }
  }, true);

  // ---------- 設定（リボン） ----------
  /** app-panel.js から呼ばれる。ui は、設定の部品を作る関数のあつまり。 */
  App.eisenPanel = function (p, b, ui) {
    function redraw() { App.refreshBlock(b); App.drawSelection(); }
    p.appendChild(ui.group(null,
      ui.row("段の数", ui.num(b, "rows", { min: 1, max: 30, step: 1, unit: "段" })),
      ui.row("4線の高さ", ui.num(b, "rowH", { min: 6, max: 40, step: 0.5, unit: "mm" })),
      ui.row("段の間", ui.num(b, "gap", { min: 0, max: 40, step: 0.5, unit: "mm" })),
      ui.row("幅", ui.num(b, "w", { min: 20, max: 400, step: 1, unit: "mm" })),
      ui.row("線の間かく", ui.seg([["565", "5：6：5"], ["111", "等分"]], b.ratio, function (v) { b.ratio = v; ui.touch(b); }), "5：6：5 は、小学校の英語の教科書と同じ間かくです。"),
      ui.check("第2線を点線にする", b.dash2, function (v) { b.dash2 = v; ui.touch(b); })));
    p.appendChild(ui.group("罫線",
      ui.row("基線の色", ui.swatches(BASE_COLORS, b.baseColor, function (v) { b.baseColor = v; ui.touch(b); })),
      ui.row("線の色", ui.swatches(LINE_COLORS, b.lineColor, function (v) { b.lineColor = v; ui.touch(b); }))));
    var ta = h("textarea", { class: "eisen-text", rows: 3, spellcheck: "false", placeholder: "紙の上の段をクリックすると、そのまま打てます。ここに打ってもよい（1行が1段）", "aria-label": "4線に入れる字" });
    ta.value = b.text || "";
    ta.addEventListener("input", function () { if (App.edit && App.edit.type === "eisen") App.stopEditing(); b.text = ta.value; redraw(); App.commit("eisen-text:" + b.id); });
    p.appendChild(ui.group("4線に入れる字",
      h("div", { class: "row" }, ta),
      ui.row("フォントの色", ui.swatches(App.TEXT_COLORS, b.color, function (v) { b.color = v; ui.touch(b); }))));
  };

  // ---------- ノートのテンプレート ----------
  /** o = { title, rows, rowH, gap } B5 縦の英語ノート。 */
  App.buildEisenNote = function (o) {
    var pw = 182, m = 12, blocks = [];
    blocks.push(App.make.text({ x: m, y: 9, w: 96, h: App.lineH(12, 1), size: 12, html: "Name（　　　　　　　　　　　）" }));
    blocks.push(App.make.text({ x: pw - m - 62, y: 9, w: 62, h: App.lineH(11, 1), size: 11, align: "end", html: "　　月　　日（　　）" }));
    blocks.push(App.make.eisen({ x: m, y: 26, w: pw - m * 2, rows: o.rows, rowH: o.rowH, gap: o.gap, locked: true }));
    return { doc: { version: 1, title: o.title, paper: "B5", orient: "portrait", margin: 10, snap: 0.5, pages: [{ blocks: blocks }] } };
  };
  if (App.NOTE_SHEETS) {
    var at = App.NOTE_SHEETS.findIndex(function (x) { return x.key === "jukugo"; });
    var add = [
      { key: "eigo8", name: "えいご 4線ノート（8段）", note: "4線の高さ16mm。はじめてアルファベットを書く学年に。B5 縦。", build: function () { return App.buildEisenNote({ title: "えいご 4線ノート（8段）", rows: 8, rowH: 16, gap: 11.5 }); } },
      { key: "eigo10", name: "えいご 4線ノート（10段）", note: "4線の高さ13mm。単語や短い文を書くときに。B5 縦。", build: function () { return App.buildEisenNote({ title: "えいご 4線ノート（10段）", rows: 10, rowH: 13, gap: 9 }); } },
      { key: "eigo13", name: "えいご 4線ノート（13段）", note: "4線の高さ10mm。高学年から中学校向け。B5 縦。", build: function () { return App.buildEisenNote({ title: "えいご 4線ノート（13段）", rows: 13, rowH: 10, gap: 6.5 }); } }
    ];
    App.NOTE_SHEETS.splice.apply(App.NOTE_SHEETS, [at < 0 ? App.NOTE_SHEETS.length : at, 0].concat(add));
  }
})();

;
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

    // 上の目次（長い画面なので、見たい所へとぶ）
    var toc = h("div", { class: "st-toc" });
    [["ノート", "st-note"], ["板書計画", "st-bansho"], ["問題を入れて作る", "st-make"], ["テンプレート", "st-tpl"], ["教科の事例", "st-ex"]].forEach(function (t) {
      toc.appendChild(h("button", { type: "button", "data-to": t[1], onclick: function () { var el = document.getElementById(t[1]); if (el) el.scrollIntoView({ block: "start" }); } }, t[0]));
    });
    body.appendChild(toc);
    var notes = App.NOTE_SHEETS || [];
    if (notes.length) {
      body.appendChild(h("h3", { id: "st-note" }, "ノート"));
      var g0 = h("div", { class: "st-grid" });
      notes.forEach(function (s) {
        g0.appendChild(card(s.name, s.note, "assets/tpl/note-" + s.key + ".webp", function () { open(App.noteDoc(s), fresh); }));
      });
      body.appendChild(g0);
    }

    // 板書計画：教科ごとに型をならべる。1つの型に「型で始める」と「記入例を見る」の2つの入口
    var kata = App.KATA || [];
    if (kata.length) {
      body.appendChild(h("h3", { id: "st-bansho" }, "板書計画"));
      body.appendChild(h("p", { class: "st-sub" }, "「型で始める」は、部品だけが置いてあります。うすい字の所をクリックして打ちます。「記入例」は、4年生の学習を例に書きこんだものです。"));
      // 教科でしぼる
      var subjects = []; kata.forEach(function (K) { if (subjects.indexOf(K.subject) < 0) subjects.push(K.subject); });
      var chips = h("div", { class: "st-chips", role: "group", "aria-label": "教科でしぼる" });
      function pick(sub) {
        Array.prototype.forEach.call(chips.children, function (c) { c.classList.toggle("on", c.dataset.sub === sub); });
        Array.prototype.forEach.call(gb.children, function (c) { c.style.display = sub === "すべて" || c.dataset.sub === sub ? "" : "none"; });
      }
      ["すべて"].concat(subjects).forEach(function (sub) {
        chips.appendChild(h("button", { type: "button", "data-sub": sub, class: sub === "すべて" ? "on" : "", onclick: function () { pick(sub); } },
          sub + (sub === "すべて" ? "" : "（" + kata.filter(function (K) { return K.subject === sub; }).length + "）")));
      });
      body.appendChild(chips);
      var gb = h("div", { class: "st-grid kata" });
      kata.forEach(function (K) {
        gb.appendChild(h("div", { class: "st-card kata", "data-kata": K.key, "data-sub": K.subject },
          h("span", { class: "st-thumb" }, h("img", { src: "assets/tpl/kata-" + K.key + ".webp", alt: "", loading: "lazy" })),
          h("span", { class: "st-tag" }, K.subject), h("span", { class: "st-name" }, K.name.replace(/^\S+　/, "")), h("span", { class: "st-note" }, K.note),
          K.free
            ? h("span", { class: "st-two" }, h("button", { type: "button", class: "btn primary", "data-go": "kata", onclick: function () { open(App.buildKata(K, false).doc, fresh); } }, "白紙で始める"))
            : h("span", { class: "st-two" },
              h("button", { type: "button", class: "btn primary", "data-go": "kata", onclick: function () { open(App.buildKata(K, false).doc, fresh); } }, "型で始める"),
              h("button", { type: "button", class: "btn", "data-go": "example", onclick: function () { open(App.buildKata(K, true).doc, fresh); } }, "記入例を見る"))));
      });
      body.appendChild(gb);
      var boards = App.BANSHO_SHEETS || [];
      if (boards.length) {
        body.appendChild(h("h4", { class: "st-h4" }, "黒板の上に、ノートと同じ数のマス目を置いたもの"));
        var gn = h("div", { class: "st-grid" });
        boards.forEach(function (s) { gn.appendChild(card(s.name, s.note, "assets/tpl/" + s.key + ".webp", function () { open(s.build().doc, fresh); })); });
        body.appendChild(gn);
      }
    }
    body.appendChild(h("h3", { id: "st-make" }, "問題を入れて作る"));
    body.appendChild(h("div", { class: "st-grid" },
      card("計算プリントを作る", "式を入れると、筆算が並びます。答えのページもできます。", "assets/tpl/keisan.webp", function () { App.openKeisan(fresh); }, "make"),
      card("漢字練習プリントを作る", "ことばを入れると、手本、なぞり書き、書くマスが並びます。", "assets/tpl/kanji.webp", function () { App.openKanji(fresh); }, "make")));

    body.appendChild(h("h3", { id: "st-tpl" }, "テンプレート"));
    var g1 = h("div", { class: "st-grid" });
    Object.keys(App.templates).forEach(function (k) {
      if (k === "hissan6") return;   // 「計算プリントを作る」と同じものなので、ここには出さない
      var t = App.templates[k];
      g1.appendChild(card(t.name, t.note || "", /^blank/.test(k) ? null : "assets/tpl/" + k + ".webp", function () { open(t.build(), fresh); }, /^blank/.test(k) ? "blank" : ""));
    });
    body.appendChild(g1);

    var ex = window.MASUME_EXAMPLES || [];
    if (ex.length) {
      body.appendChild(h("h3", { id: "st-ex" }, "教科の事例"));
      var g2 = h("div", { class: "st-grid" });
      ex.forEach(function (e) {
        g2.appendChild(card(e.name, (e.paper || "") + (e.pages > 1 ? "、" + e.pages + "ページ" : ""), "examples/thumb/" + e.key + "_p1.webp", function () { open(e.doc, fresh); }));
      });
      body.appendChild(g2);
    }
    body.appendChild(h("p", { class: "st-foot" }, "できあがったプリントやノートの PDF は、",
      h("a", { href: "https://a-tozak.github.io/School_Stock/", target: "_blank", rel: "noopener" }, "School Stock の棚"), "にもあります。"));
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
    var barProps = { class: "float-bar no-print", onpointerdown: function (ev) { ev.stopPropagation(); }, onmousedown: function (ev) { ev.preventDefault(); ev.stopPropagation(); } };
    var bar = f.block.locked
      ? h("div", barProps,
        b("ロック解除", function () { App.setLocked(id, false); }),
        b("複製", function () { App.duplicate(id); }))
      : h("div", barProps,
        b("複製", function () { App.duplicate(id); }),
        b("前面へ", function () { App.reorder(id, "front"); }),
        b("背面へ", function () { App.reorder(id, "back"); }),
        b("ロック", function () { App.setLocked(id, true); }),
        h("span", { class: "sep" }),
        b("削除", function () { App.removeBlock(id); }, "danger"));
    // 部品の右上に、右はしをそろえて置く。紙の上はしに近いときは、部品の下に出す
    // つまみ（部品の左上の札）と重ならないように、札の高さ（画面で26px）だけ上に上げる
    var lift = 26 * k, above = r.y > 17 * k;
// 右はしをそろえて置く。紙の左はしに近くてバーが紙の外（左の道具の裏）に出るときは、左はしをそろえる
    var barMm = (f.block.locked ? 190 : 340) * k * 0.2646, leftAlign = r.x + r.w - barMm < 0;
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
  /** 読みこみ中の画面を消す。字の読みこみを待つが、待ちすぎない（長くて4秒）。 */
  function hideLoading() {
    var el = document.getElementById("loading");
    if (!el || el.dataset.done) return;
    el.dataset.done = "1";
    el.classList.add("out");
    setTimeout(function () { el.remove(); }, 350);
  }
  // ---------- スマホで開いた人へ：パソコンへリンクを送る ----------
  var HOME = "https://a-tozak.github.io/School_Stock/tools/masume-print/about.html";
  App.openSendToPc = function () {
    var old = document.getElementById("pc-dialog"); if (old) old.remove();
    function close() { wrap.remove(); }
    var msg = h("p", { class: "hint pc-msg" });
    var body = h("div", { class: "dlg-body pc-body" },
      h("p", null, "この道具は、画面の広いパソコン（Windows、Chromebook、Mac）で使います。スマホでは、できることを見るだけにして、作るのはパソコンで行ってください。"),
      h("div", { class: "pc-btns" },
        navigator.share ? h("button", { type: "button", class: "btn primary", onclick: function () {
          navigator.share({ title: "マス目プリントメーカー｜School Stock", text: "ワークシートをブラウザで作って刷る道具です。パソコンで開いてください。", url: HOME }).catch(function () {});
        } }, "リンクを自分に送る（メール、LINE など）") : null,
        h("button", { type: "button", class: "btn", onclick: function () {
          (navigator.clipboard ? navigator.clipboard.writeText(HOME) : Promise.reject()).then(function () { msg.textContent = "リンクをコピーしました。メールやメモに貼って、パソコンで開いてください。"; })
            .catch(function () { msg.textContent = HOME; });
        } }, "リンクをコピーする")),
      msg,
      h("p", { class: "pc-search" }, "パソコンで探すときは、", h("b", null, "「School Stock 教材」"), "で検索して、School Stock の棚から「マス目プリントメーカー」を開きます。"),
      h("div", { class: "pc-btns" },
        h("a", { class: "btn", href: "about.html" }, "できることを見る"),
        h("button", { type: "button", class: "btn ghost", onclick: close }, "このまま開く")));
    var wrap = h("div", { id: "pc-dialog", class: "dlg" },
      h("div", { class: "dlg-box", role: "dialog", "aria-label": "パソコンで使う道具です" },
        h("div", { class: "dlg-head" }, h("b", null, "パソコンで使う道具です"), h("button", { type: "button", class: "btn ghost", onclick: close }, "閉じる")), body));
    document.body.appendChild(wrap);
  };

  window.addEventListener("load", function () {
    if (window.innerWidth < 820 && !/[?&](t|e|src)=/.test(location.search)) setTimeout(App.openSendToPc, 300);
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(function () { if (App.fitMode === "page") App.fitPage(); hideLoading(); });
    setTimeout(hideLoading, 4000);
    var bt = App.$("#btn-tpl");
    if (bt) bt.addEventListener("click", function () { App.openStart(false); });
    var q = new URLSearchParams(location.search);
    if (firstVisit && window.innerWidth >= 820 && !q.get("t") && q.get("e") === null && !q.get("src")) App.openStart(true);
  });
})();

;
/* マス目プリントメーカー：PDF と画像（PNG）で保存する
 * 外のライブラリを使わずに、ブラウザの中だけで作る。
 *   1) 紙面（.page）を写して、スタイルごと SVG の foreignObject に入れる
 *   2) それを画像として canvas に描く（刷るのに足りる細かさで）
 *   3) PNG はそのまま保存。PDF は、各ページを JPEG にして、自分で PDF の形に組む
 * できた PDF と画像は、あとから直せない。直すための「編集用のファイル」は、別に保存できる。
 */
(function () {
  "use strict";
  var App = window.App, h = App.h;
  var DPI_PDF = 250, DPI_PNG = 200;

  // ---------- スタイルを集める ----------
  var cssCache = null, fontCache = {};
  function collectCss() {
    if (cssCache !== null) return cssCache;
    var out = [];
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      var rules;
      try { rules = sheet.cssRules; } catch (e) { return; }
      Array.prototype.forEach.call(rules || [], function (r) {
        if (r.type === CSSRule.FONT_FACE_RULE) return;          // 字は下で、要るものだけ埋めこむ
        if (r.type === CSSRule.MEDIA_RULE && /print/.test(r.conditionText || (r.media && r.media.mediaText) || "")) return;
        out.push(r.cssText);
      });
    });
    cssCache = out.join("\n");
    return cssCache;
  }
  function toBase64(buf) {
    var bytes = new Uint8Array(buf), s = "", i;
    for (i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  /** この道具に入っている字（Klee One）を使っているときだけ、字のデータを埋めこむ。パソコンの中の字は、そのまま使える。 */
  function fontCss() {
    var use = App.kyokashoInUse ? App.kyokashoInUse() : { rank: 0 };
    if (use.rank !== 2) return Promise.resolve("");
    var files = [["400", "assets/fonts/KleeOne-Regular.core.woff2"], ["600 700", "assets/fonts/KleeOne-SemiBold.core.woff2"]];
    return Promise.all(files.map(function (f) {
      if (fontCache[f[1]]) return fontCache[f[1]];
      return fetch(f[1]).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        return (fontCache[f[1]] = '@font-face{font-family:"Klee One";font-weight:' + f[0] + ';src:url(data:font/woff2;base64,' + toBase64(buf) + ') format("woff2");}');
      }).catch(function () { return ""; });
    })).then(function (a) { return a.join("\n"); }).then(function (css) { return warmFont(css).then(function () { return css; }); });
  }
  /** 埋めこんだ字が、絵の中で使えるようになるまで待つ。
   *  用意ができるまで、絵の中の字は見えない（何も描かれない）。小さな絵に字を1つ描き、黒い点が出るまでくり返す（長くて5秒）。 */
  function warmFont(css) {
    if (!css) return Promise.resolve();
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>' + css +
      '</style><span style="font:400 40px \'Klee One\';color:#000">永あ</span><span style="font:700 40px \'Klee One\';color:#000">永</span></div></foreignObject></svg>';
    var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), tries = 0;
    function once() {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var cv = document.createElement("canvas"); cv.width = 120; cv.height = 60;
          var c = cv.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, 120, 60); c.drawImage(img, 0, 0);
          var d = c.getImageData(0, 0, 120, 60).data, dark = 0;
          for (var i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
          resolve(dark > 40);
        };
        img.onerror = function () { resolve(true); };
        img.src = url;
      });
    }
    function loop() {
      return once().then(function (okNow) {
        if (okNow || ++tries > 32) return;
        return new Promise(function (r) { setTimeout(r, 150); }).then(loop);
      });
    }
    return loop();
  }

  // ---------- 1ページを canvas に描く ----------
  function pageCanvas(pi, dpi, fontsCss) {
    var src = App.pageEl(pi), size = App.pageSize();
    var k = dpi / 96, W = Math.round(size[0] * App.MM * k), H = Math.round(size[1] * App.MM * k);
    var clone = src.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll(".no-print, .float-bar, .selbox"), function (n) { n.remove(); });
    Array.prototype.forEach.call(clone.querySelectorAll("[contenteditable]"), function (n) { n.removeAttribute("contenteditable"); });
    clone.style.transform = "scale(" + k + ")";
    clone.style.transformOrigin = "0 0";
    clone.style.boxShadow = "none";
    clone.style.margin = "0";
    var wrap = document.createElement("div");
    wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrap.style.cssText = "width:" + W + "px;height:" + H + "px;overflow:hidden;background:#fff;position:relative";
    var st = document.createElement("style");
    st.textContent = fontsCss + "\n" + collectCss() + "\n.page{position:absolute;left:0;top:0;background:#fff}\n.tx:empty::before{content:\"\" !important}";
    wrap.appendChild(st);
    wrap.appendChild(clone);
    var xml = new XMLSerializer().serializeToString(wrap);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject x="0" y="0" width="100%" height="100%">' + xml + "</foreignObject></svg>";
    var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    function drawOnce() {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var ready = img.decode ? img.decode().catch(function () {}) : Promise.resolve();
          ready.then(function () {
            var cv = document.createElement("canvas");
            cv.width = W; cv.height = H;
            var ctx = cv.getContext("2d");
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
            ctx.drawImage(img, 0, 0, W, H);
            resolve(cv);
          });
        };
        img.onerror = function () { reject(new Error("紙面を画像にできませんでした")); };
        img.src = url;
      });
    }
    /** 小さく写して、黒さを数える。字がまだ描かれていない絵と、描かれた絵を見分けるため。 */
    function ink(cv) {
      var t = document.createElement("canvas"), tw = 240, th = Math.max(1, Math.round(240 * H / W));
      t.width = tw; t.height = th;
      var c = t.getContext("2d");
      c.drawImage(cv, 0, 0, tw, th);
      var d = c.getImageData(0, 0, tw, th).data, sum = 0;
      for (var i = 0; i < d.length; i += 4) sum += 765 - d[i] - d[i + 1] - d[i + 2];
      return sum;
    }
    // 絵の中の字は、絵が「読みこめた」と言ったあとに、おくれて用意されることがある（1回目の絵だけ字がぬける）。
    // 同じ絵を、間をあけてもう一度描き、2回の黒さが同じになるまで待つ。
    function settle(prev, prevInk, tries) {
      return new Promise(function (r) { setTimeout(r, tries === 0 ? 120 : 300); }).then(drawOnce).then(function (cv) {
        var now = ink(cv);
        prev.width = prev.height = 0;
        if (Math.abs(now - prevInk) <= Math.max(50, prevInk * 0.002) || tries >= 5) return cv;
        return settle(cv, now, tries + 1);
      });
    }
    return drawOnce().then(function (cv) { return settle(cv, ink(cv), 0); });
  }
  function canvasBytes(cv, type, q) {
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (b) { if (!b) return reject(new Error("画像にできませんでした")); b.arrayBuffer().then(function (a) { resolve(new Uint8Array(a)); }); }, type, q);
    });
  }

  // ---------- PDF を組む（1ページに JPEG を1枚） ----------
  function buildPdf(pages, wmm, hmm) {
    var enc = new TextEncoder(), chunks = [], offsets = [], pos = 0;
    function put(x) { var b = typeof x === "string" ? enc.encode(x) : x; chunks.push(b); pos += b.length; }
    function obj(n, body, stream) {
      offsets[n] = pos;
      put(n + " 0 obj\n" + body + "\n");
      if (stream) { put("stream\n"); put(stream); put("\nendstream\n"); }
      put("endobj\n");
    }
    var Wpt = (wmm * 72 / 25.4).toFixed(2), Hpt = (hmm * 72 / 25.4).toFixed(2), n = pages.length;
    put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + i * 3) + " 0 R");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Count " + n + " /Kids [" + kids.join(" ") + "] >>");
    pages.forEach(function (p, i) {
      var po = 3 + i * 3, co = po + 1, io = po + 2;
      var content = "q " + Wpt + " 0 0 " + Hpt + " 0 0 cm /Im0 Do Q";
      obj(po, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + Wpt + " " + Hpt + "] /Resources << /XObject << /Im0 " + io + " 0 R >> >> /Contents " + co + " 0 R >>");
      obj(co, "<< /Length " + content.length + " >>", content);
      obj(io, "<< /Type /XObject /Subtype /Image /Width " + p.w + " /Height " + p.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.bytes.length + " >>", p.bytes);
    });
    var total = 3 + n * 3, xref = pos;
    put("xref\n0 " + total + "\n0000000000 65535 f \n");
    for (var k = 1; k < total; k++) put(("0000000000" + offsets[k]).slice(-10) + " 00000 n \n");
    put("trailer\n<< /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    return new Blob(chunks, { type: "application/pdf" });
  }

  // ---------- ZIP を組む（圧縮なし。PNG が2ページ以上のとき） ----------
  var crcTable = null;
  function crc32(b) {
    if (!crcTable) { crcTable = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) crc = crcTable[(crc ^ b[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function buildZip(files) {
    var enc = new TextEncoder(), parts = [], central = [], pos = 0;
    function u16(v) { return [v & 255, (v >> 8) & 255]; }
    function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.bytes), len = f.bytes.length;
      var head = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(len), u32(len), u16(name.length), u16(0));
      central.push({ head: [].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(len), u32(len), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(pos)), name: name });
      parts.push(new Uint8Array(head), name, f.bytes);
      pos += head.length + name.length + len;
    });
    var cstart = pos, csize = 0;
    central.forEach(function (c) { parts.push(new Uint8Array(c.head), c.name); csize += c.head.length + c.name.length; });
    parts.push(new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(cstart), u16(0))));
    return new Blob(parts, { type: "application/zip" });
  }

  function download(blob, name) {
    var a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function safeName() { return (App.doc.title || "プリント").replace(/[\\/:*?"<>|\n\r]/g, "_").slice(0, 80); }

  /** kind = "pdf" か "png"。返すのは Promise（テストからも使う）。 */
  App.exportAs = function (kind) {
    App.stopEditing();
    App.selId = null;
    App.drawSelection();
    var n = App.doc.pages.length, size = App.pageSize(), dpi = kind === "pdf" ? DPI_PDF : DPI_PNG, name = safeName();
    App.toast((kind === "pdf" ? "PDF" : "画像") + "を作っています…（" + n + "ページ）", 60000);
    return fontCss().then(function (fcss) {
      var results = [], chain = Promise.resolve();
      for (var i = 0; i < n; i++) (function (pi) {
        chain = chain.then(function () { return pageCanvas(pi, dpi, fcss); }).then(function (cv) {
          return canvasBytes(cv, kind === "pdf" ? "image/jpeg" : "image/png", 0.92).then(function (bytes) { results.push({ w: cv.width, h: cv.height, bytes: bytes }); cv.width = cv.height = 0; });
        });
      })(i);
      return chain.then(function () { return results; });
    }).then(function (pages) {
      var blob, file;
      if (kind === "pdf") { blob = buildPdf(pages, size[0], size[1]); file = name + ".pdf"; }
      else if (pages.length === 1) { blob = new Blob([pages[0].bytes], { type: "image/png" }); file = name + ".png"; }
      else { blob = buildZip(pages.map(function (p, i) { return { name: name + "_" + (i + 1) + ".png", bytes: p.bytes }; })); file = name + "_画像.zip"; }
      download(blob, file);
      App.toast("「" + file + "」を保存しました。");
      return { blob: blob, file: file, pages: pages.length };
    }).catch(function (e) {
      App.toast("保存できませんでした。右上の「印刷」から「PDF に保存」を選ぶ方法も使えます。", 7000);
      throw e;
    });
  };

  // ---------- 「保存」のメニュー ----------
  function closeMenu() { var m = document.getElementById("save-menu"); if (m) m.remove(); }
  App.openSaveMenu = function () {
    if (document.getElementById("save-menu")) return closeMenu();
    var btn = App.$("#btn-save"), r = btn.getBoundingClientRect();
    function item(title, note, fn, id) {
      return h("button", { type: "button", id: id, onclick: function () { closeMenu(); fn(); } }, h("b", null, title), h("small", null, note));
    }
    var menu = h("div", { id: "save-menu", class: "save-menu", role: "menu" },
      item("PDF で保存", "刷ったり、配ったりするとき。用紙の大きさのまま保存します。", function () { App.exportAs("pdf"); }, "save-pdf"),
      item("画像（PNG）で保存", "スライドやおたよりに貼るとき。2ページ以上は、ZIP にまとめます。", function () { App.exportAs("png"); }, "save-png"),
      h("hr"),
      item("続きから直せるファイルで保存", "この道具の「開く」で開くと、続きから直せます（.json という種類のファイルです）。PDF と画像は、あとから直せません。", function () { App.saveFile(); }, "save-json"));
    menu.style.top = (r.bottom + 6) + "px";
    menu.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    document.body.appendChild(menu);
  };
  document.addEventListener("pointerdown", function (ev) {
    if (document.getElementById("save-menu") && !(ev.target.closest && ev.target.closest("#save-menu, #btn-save"))) closeMenu();
  }, true);
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeMenu(); });
})();

;
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
    eisen: ["M3 6h18", "M3 18h18", s("path", { d: "M3 10.5h18", "stroke-dasharray": "1.6 1.6" }), s("path", { d: "M3 14.5h18", stroke: "#d8574c", "stroke-width": 2 })],
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
    else if (b.type === "eisen" && App.eisenPanel) App.eisenPanel(p, b, { group: group, row: row, num: num, seg: seg, check: check, swatches: swatches, select: select, touch: touch });
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
        h("li", null, "ほかのフォントを使いたいときは、マス目やテキストボックスを選んで「フォント」から「パソコンの中のフォントから選ぶ」を押します。")),
      h("h3", null, "School Stock"),
      h("ul", null,
        h("li", null, h("a", { href: "https://a-tozak.github.io/School_Stock/", target: "_blank", rel: "noopener" }, "School Stock のトップ"), "　先生がそのまま使える教材の、無料の棚です。"),
        h("li", null, h("a", { href: "https://a-tozak.github.io/School_Stock/tools/note-prints/", target: "_blank", rel: "noopener" }, "ノートプリント集"), "　ノートを PDF でそのまま刷りたいとき。"),
        h("li", null, h("a", { href: "https://a-tozak.github.io/School_Stock/tools/pdf-toolbox/", target: "_blank", rel: "noopener" }, "先生のPDF道具箱"), "　できた PDF を結合したり、書きこんだりするとき。"),
        h("li", null, h("a", { href: "https://a-tozak.github.io/School_Stock/prints/", target: "_blank", rel: "noopener" }, "プリントの棚"), "　できあがったプリントを探すとき。")));
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
    App.fitPage();
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
    // ロック中は、位置の入力を止め、消すボタンを出さない
    if (b.locked) {
      if (pos) Array.prototype.forEach.call(pos.querySelectorAll("input"), function (i) { i.disabled = true; });
      return group("配置",
        pos,
        h("div", { class: "btns" },
          button("ロック解除", function () { App.setLocked(b.id, false); }),
          button("複製", function () { App.duplicate(b.id); })));
    }
    return group("配置",
      pos,
      h("div", { class: "btns" },
        button("前面へ", function () { App.reorder(b.id, "front"); }),
        button("背面へ", function () { App.reorder(b.id, "back"); }),
        button("複製", function () { App.duplicate(b.id); }),
        button("ロック", function () { App.setLocked(b.id, true); }),
        button("削除", function () { App.removeBlock(b.id); }, "danger"))
    );
  }

  function masuPanel(p, b) {
    var cellNum = num(b, "cell", { min: 4, max: 40, step: 0.5, unit: "mm" });
    var linesNum = num(b, "lines", { min: 1, max: 80, step: 1, unit: "行", set: function (v) { App.setMasuLines(b, v); } });
    p.appendChild(group(null,
      row("文字の方向", seg([["v", "縦書き"], ["h", "横書き"]], b.dir, function (v) {
        if (b.dir === v) return;
        b.dir = v;
        if (!(b.gap > 0)) {
          // 行間のないマス目（方眼やノート）は、形と場所をそのままにして、字の進む向きだけを変える
          var pl = b.perLine; b.perLine = b.lines; b.lines = pl;
        } else if (!b.locked) {
          // 行間のあるマス目は、向きといっしょに形が変わる。紙からはみ出すときは、紙の中へ寄せる
          var g = App.masuGeom(b), size = App.pageSize(), m = App.doc.margin || 0;
          if (b.x + g.W > size[0] - m) b.x = Math.max(0, App.snap(size[0] - m - g.W));
          if (b.y + g.H > size[1] - m) b.y = Math.max(0, App.snap(size[1] - m - g.H));
        }
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
      row("サイズ", seg([[0.56, "小"], [0.68, "中"], [0.8, "大"]], b.fontScale, function (v) { b.fontScale = v; touch(b); })),
      fontRow(b),
      // Word と同じ：字を選んでいれば、その字だけ。選んでいなければ、マス目ぜんぶ
      row("フォントの色", swatches(App.TEXT_COLORS, b.color, function (v) {
        if (App.masuHasRange()) { App.applyMasuStyle({ color: v === b.color ? null : v }); return; }
        b.color = v; touch(b);
        if (b.text) App.toast("マス目ぜんぶの字の色を変えました。一部だけ変えるときは、字をドラッグで選んでから色を押します。", 5000);
      }))
    ));

    p.appendChild(group("選択した文字",
      h("p", { class: "hint" }, "マス目の中をドラッグして、文字を選択します。"),
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
    if (App.textPanelExtra) App.textPanelExtra(p, b, { group: group, row: row, num: num, seg: seg, check: check, swatches: swatches, select: select, touch: touch });
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
      row("フォントの色", swatches([["黒", "#1b1b1b"], ["白（黒板用）", "#ffffff"], ["黄（黒板用）", "#ffe066"]], b.color || "#1b1b1b", function (v) { b.color = v; touch(b); })),
      row("答えの色", swatches([["赤", "#d12a1e"], ["黒", "#1b1b1b"], ["青", "#1d5fbf"], ["黄（黒板用）", "#ffe066"]], b.ansColor, function (v) { b.ansColor = v; touch(b); })),
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
    tool("eisen", "英語4線", "英語の4線（英習罫）を置く", function () { App.addBlock("eisen"); });
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
    App.$("#zoom-page").addEventListener("click", function () { App.fitPage(); });
    App.$("#btn-print").addEventListener("click", function () { App.print(); });
    App.$("#btn-save").addEventListener("click", function () { App.openSaveMenu(); });
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
    App.fitPage();
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
