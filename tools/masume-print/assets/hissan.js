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
