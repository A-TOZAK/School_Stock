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
