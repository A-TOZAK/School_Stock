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
