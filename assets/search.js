/* search.js — トップの「学年と教科でさがす」（2026-10-15）
 *
 * 索引は assets/search-index.json（_build/build_search.py が各棚のカードから作る）。
 * 最初に触ったときだけ読みこむ。入力欄の「小学校3年算数」「3年 わり算」のような言葉からも
 * 学年と教科を読み取る。ボタンで選んだ学年・教科があれば、そちらを優先する。
 * 検索の状態は ?g=3&s=算数&q=… でURLに残すので、そのまま人に送れる。
 */
(function () {
  'use strict';
  var root = document.getElementById('sagasu');
  if (!root) return;
  var form = root.querySelector('form');
  var input = root.querySelector('input[type=search]');
  var out = root.querySelector('.ss-results');
  var status = root.querySelector('.ss-status');
  var gBtns = root.querySelectorAll('[data-g]');
  var sBtns = root.querySelectorAll('[data-s]');
  var st = { g: 0, s: '' };
  var data = null, loading = null;
  var PER_GROUP = 6;

  // 棚のページで学年の見出しに飛べるもの
  var SEC = {
    'prints/sansu/': 'sec-g', 'prints/sansu-ensyu/': 'sec-g', 'prints/rika/': 'sec-g', 'prints/shakai/': 'sec-g'
  };

  var TSUKAERU = { '算数': 'sansu', '国語': 'kokugo', '理科': 'rika', '社会': 'shakai' };

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = fetch('assets/search-index.json').then(function (r) { return r.json(); })
        .then(function (d) { data = d; return d; });
    }
    return loading;
  }

  function z2h(t) { return t.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  var KAN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
  var SUBJ = [['国語', '国語'], ['こくご', '国語'], ['算数', '算数'], ['さんすう', '算数'], ['数学', '数学'],
    ['理科', '理科'], ['りか', '理科'], ['社会', '社会'], ['しゃかい', '社会'], ['体育', '体育'], ['たいいく', '体育'],
    ['英語', '英語'], ['えいご', '英語'], ['外国語', '英語']];

  // 入力の言葉から学年・教科を取り出し、残りを言葉の条件にする
  function parse(q) {
    q = z2h(q || '');
    var g = 0, s = '';
    var m = q.match(/(?:小学校?|小)?\s*([1-6])\s*年(?:生)?/) || q.match(/小\s*([1-6])/);
    if (m) { g = +m[1]; q = q.replace(m[0], ' '); }
    else {
      var k = q.match(/([一二三四五六])年(?:生)?/);
      if (k) { g = KAN[k[1]]; q = q.replace(k[0], ' '); }
      else if (/中学/.test(q)) { g = 7; q = q.replace(/中学校?(?:生)?/, ' '); }
    }
    for (var i = 0; i < SUBJ.length; i++) {
      if (q.indexOf(SUBJ[i][0]) >= 0) { s = SUBJ[i][1]; q = q.replace(SUBJ[i][0], ' '); break; }
    }
    q = q.replace(/小学校|小学生|の|プリント|教材/g, ' ');
    var words = q.split(/[\s　、,・]+/).filter(function (w) { return w.length > 0; });
    return { g: g, s: s, words: words };
  }

  function norm(t) { return z2h(t).toLowerCase(); }

  function run(push) {
    var p = parse(input.value);
    var g = st.g || p.g, s = st.s || p.s;
    if (!g && !s && !p.words.length) { out.innerHTML = ''; status.textContent = ''; if (push) sync(); return; }
    status.textContent = 'さがしています…';
    load().then(function (d) {
      var hits = d.filter(function (x) {
        if (g && x.g.indexOf(g) < 0) return false;
        if (s && x.s.indexOf(s) < 0) return false;
        if (p.words.length) {
          var hay = norm(x.t + ' ' + x.k + ' ' + x.p + ' ' + x.d);
          for (var i = 0; i < p.words.length; i++) if (hay.indexOf(norm(p.words[i])) < 0) return false;
        }
        return true;
      });
      render(hits, g, s, p.words);
      if (push) sync();
    }).catch(function () {
      status.textContent = '一覧を読みこめませんでした。時間をおいて、もう一度お試しください。';
    });
  }

  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function label(g, s, words) {
    var a = [];
    if (g) a.push(g === 7 ? '中学' : g + '年');
    if (s) a.push(s);
    if (words.length) a.push('「' + words.join(' ') + '」');
    return a.join('・');
  }

  function render(hits, g, s, words) {
    var lab = label(g, s, words);
    if (!hits.length) {
      status.textContent = lab + 'に当てはまる教材は、まだありません。言葉を短くするか、学年か教科の選択を外してください。';
      out.innerHTML = '';
      return;
    }
    status.textContent = lab + 'の教材が ' + hits.length + '件 あります。';
    var groups = [], idx = {};
    hits.forEach(function (x) {
      if (!(x.p in idx)) { idx[x.p] = groups.length; groups.push({ p: x.p, pu: x.pu, items: [] }); }
      groups[idx[x.p]].items.push(x);
    });
    var html = groups.map(function (gr) {
      var shelf = '';
      if (gr.pu) {
        var href = gr.pu;
        if (g && g <= 6 && SEC[gr.pu]) href += '#' + SEC[gr.pu] + g;
        if (gr.pu === 'prints/furikaeri/' && g && g <= 6) href += '#' + g + '年';
        if (gr.pu === 'prints/tsukaeru/' && g && g <= 6 && TSUKAERU[s]) href += '#sec-' + TSUKAERU[s] + '-g' + g;
        shelf = '<a class="ss-shelf" href="' + esc(href) + '">棚で見る →</a>';
      }
      var items = gr.items.map(function (x, i) {
        var ext = /^https?:/.test(x.u);
        var pdf = /\.pdf$/i.test(x.u);
        return '<li' + (i >= PER_GROUP ? ' hidden' : '') + '><a href="' + esc(x.u) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' +
          '<b>' + esc(x.t) + '</b>' +
          (x.d ? '<span>' + esc(x.d) + '</span>' : '') +
          (pdf ? '<i>PDF</i>' : '') + '</a></li>';
      }).join('');
      var more = gr.items.length > PER_GROUP ?
        '<button type="button" class="ss-more">ほかに' + (gr.items.length - PER_GROUP) + '件を表示する</button>' : '';
      return '<div class="ss-group"><div class="ss-gh"><h3>' + esc(gr.p) + '<small>' + gr.items.length + '件</small></h3>' + shelf + '</div>' +
        '<ul>' + items + '</ul>' + more + '</div>';
    }).join('');
    out.innerHTML = html;
  }

  function paint() {
    gBtns.forEach(function (b) { var on = +b.dataset.g === st.g; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    sBtns.forEach(function (b) { var on = b.dataset.s === st.s; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  }

  function sync() {
    try {
      var u = new URL(location.href);
      ['g', 's', 'q'].forEach(function (k) { u.searchParams.delete(k); });
      if (st.g) u.searchParams.set('g', st.g);
      if (st.s) u.searchParams.set('s', st.s);
      if (input.value.trim()) u.searchParams.set('q', input.value.trim());
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { }
  }

  gBtns.forEach(function (b) {
    b.addEventListener('click', function () { st.g = st.g === +b.dataset.g ? 0 : +b.dataset.g; paint(); run(true); });
  });
  sBtns.forEach(function (b) {
    b.addEventListener('click', function () { st.s = st.s === b.dataset.s ? '' : b.dataset.s; paint(); run(true); });
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); run(true); });
  var timer;
  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { run(true); }, 250); });
  input.addEventListener('focus', load, { once: true });
  out.addEventListener('click', function (e) {
    var b = e.target.closest('.ss-more');
    if (!b) return;
    b.parentNode.querySelectorAll('li[hidden]').forEach(function (li) { li.hidden = false; });
    b.remove();
  });
  root.querySelector('.ss-clear').addEventListener('click', function () {
    st.g = 0; st.s = ''; input.value = ''; paint(); run(true); input.focus();
  });

  // ?g=3&s=算数&q=わり算 で開かれたら、その条件で表示する
  try {
    var sp = new URLSearchParams(location.search);
    var g0 = +sp.get('g'), s0 = sp.get('s') || '', q0 = sp.get('q') || '';
    if (g0 >= 1 && g0 <= 7) st.g = g0;
    if (s0) st.s = s0;
    if (q0) input.value = q0;
    if (st.g || st.s || q0) { paint(); run(false); }
  } catch (e) { }
})();
