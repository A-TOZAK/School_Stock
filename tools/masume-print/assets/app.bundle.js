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
      if (moved) {
        if (App.fitToMasu(b)) { App.refreshBlock(b); App.measureAuto(); App.drawSelection(); }
        App.commit(); App.renderPanel();
      }
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
      if (mod && (key === "s" || key === "S")) { ev.preventDefault(); App.openSaveMenu(); return; }
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
        text: o.headRow || "", autoGrow: false });
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
    { key: "kokugo", name: "低学年 作文ノート", note: "18mmのマス。たて12マスが7行（84字）。行の右に、ふりがなを書くすきまがあります。B5 縦。",
      opts: { title: "低学年 作文ノート", paper: "B5", orient: "portrait", dir: "v", cell: 18, perLine: 12, lines: 7, gap: 5.8, leader: true, top: 26, rules: { danrakuSage: true } } },
    { key: "jukugo", name: "漢字・熟語 学習プリント", note: "熟語の意味と文を書く表と、18mmの練習マスが1枚になっています。B4 横。",
      build: function () { return App.buildJukugo(); } }
  ];
  /** ノートの紙面を作る。 */
  App.noteDoc = function (s) { return (s.build ? s.build() : App.buildNote(s.opts)).doc; };
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
    })).then(function (a) { return a.join("\n"); });
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
    st.textContent = fontsCss + "\n" + collectCss() + "\n.page{position:absolute;left:0;top:0;background:#fff}";
    wrap.appendChild(st);
    wrap.appendChild(clone);
    var xml = new XMLSerializer().serializeToString(wrap);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject x="0" y="0" width="100%" height="100%">' + xml + "</foreignObject></svg>";
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        var ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        resolve(cv);
      };
      img.onerror = function () { reject(new Error("紙面を画像にできませんでした")); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
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
      row("サイズ", seg([[0.56, "小"], [0.68, "中"], [0.8, "大"]], b.fontScale, function (v) { b.fontScale = v; touch(b); })),
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
