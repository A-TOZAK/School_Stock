/* ai-erabi.js — 教材えらびをAIに相談するボタン（トップページ専用）
 *
 * プロンプトはクリックした瞬間に SITE MAP（.drawer nav）から組み立てる。
 * 棚を足すときにドロワーへ1行足せば、ここは何も直さなくてよい（保守ゼロ設計）。
 *
 * 挙動（2026-08-27 実測・調査）:
 *  - ChatGPT: https://chatgpt.com/?prompt=… で入力欄にプレフィルされる（自動送信なし・実機確認済み）
 *  - Claude:  https://claude.ai/new?q=… 形式。効かない環境に備えクリップボード併用
 *  - Gemini:  URLプレフィル非対応 → コピーして開き、貼り付けてもらう
 *  - 全ボタン共通: フル版プロンプトをクリップボードへコピーしてから新規タブで開く
 */
(function () {
  'use strict';

  var SITE = 'https://a-tozak.github.io/School_Stock/';

  /* ---------- SITE MAP から棚一覧を読む ---------- */

  // 教材の提案に使わないセクション（人のつながり・サイト説明）
  var SKIP_SECTIONS = ['ABOUT', 'つながる'];

  function collectShelves() {
    var nav = document.querySelector('.drawer nav');
    var sections = [];
    if (!nav) return sections;
    var current = null;
    var nodes = nav.children;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.classList && el.classList.contains('dr-sec')) {
        var name = (el.textContent || '').trim();
        current = { name: name, items: [] };
        if (SKIP_SECTIONS.indexOf(name.split('｜')[0]) === -1 && SKIP_SECTIONS.indexOf(name) === -1) {
          sections.push(current);
        }
        continue;
      }
      if (el.tagName !== 'A' || !current) continue;
      var href = el.getAttribute('href') || '';
      if (!href || href === './' || href.charAt(0) === '#') continue;      // 棚トップ・ページ内リンク
      var small = el.querySelector('small');
      var desc = small ? (small.textContent || '').trim() : '';
      var title = (el.textContent || '').replace(desc, '').replace(/[↗\s]+$/, '').trim();
      if (/パスワード|限定/.test(title + desc)) continue;                  // 施錠棚は勧めない
      var url;
      try { url = new URL(href, SITE).href; } catch (e) { continue; }
      current.items.push({ title: title, desc: desc, url: url, sub: el.classList.contains('sub2') });
    }
    return sections.filter(function (s) { return s.items.length > 0; });
  }

  // 予備: ドロワーが読めないときはトップの教材カードから拾う
  function collectFromCards() {
    var items = [];
    var cards = document.querySelectorAll('a.item');
    for (var i = 0; i < cards.length; i++) {
      var a = cards[i];
      var h2 = a.querySelector('h2');
      var p = a.querySelector('p');
      var href = a.getAttribute('href') || '';
      if (!h2 || !href || href.charAt(0) === '#') continue;
      var url;
      try { url = new URL(href, SITE).href; } catch (e) { continue; }
      items.push({ title: (h2.textContent || '').trim(), desc: p ? (p.textContent || '').trim() : '', url: url, sub: false });
    }
    return items.length ? [{ name: '教材の棚', items: items }] : [];
  }

  /* ---------- プロンプトを組み立てる ---------- */

  function shelfLines(sections, withDesc) {
    var lines = [];
    sections.forEach(function (sec) {
      lines.push('【' + sec.name + '】');
      sec.items.forEach(function (it) {
        if (it.sub && !withDesc) return;               // 短縮版は子ページを省く
        var head = it.sub ? '  - ' : '- ';
        var desc = withDesc && it.desc ? '｜' + it.desc : '';
        lines.push(head + it.title + desc + '｜' + it.url);
      });
    });
    return lines.join('\n');
  }

  function buildPrompt(withDesc) {
    var sections = collectShelves();
    if (!sections.length) sections = collectFromCards();
    return [
      'あなたは、無料教材サイト「School Stock」の案内係です。',
      '',
      '■ School Stock とは',
      '現役の小学校教員がつくっている、無料の教材と道具の棚です。すべて無料・登録不要で、えらんでダウンロードするだけで使えます。',
      'トップページ: ' + SITE,
      '',
      '■ 棚の一覧',
      shelfLines(sections, withDesc),
      '',
      '■ 進め方',
      '1. まず、私に次の3つを番号つきで一度に質問してください。',
      '   ① 担当の学年',
      '   ② 教科と、いま学習している単元',
      '   ③ 困っていることや、使いたい場面（例: 宿題にしたい・早く終わった子にわたしたい・支援が必要な子がいる）',
      '2. 回答をもとに、上の一覧から合う教材を2〜3個えらび、「名前・URL・教室でどう使うか（1〜2行）」の形で提案してください。',
      '3. くわしく知りたい棚があれば、そのURLを開いて中身をたしかめてから提案してもかまいません。',
      '',
      '■ 約束',
      '- 上の一覧にある教材だけを提案してください。一覧にないものを作らないでください。',
      '- 提案には必ずURLを添えてください。',
      '- 教材はすべて無料・登録不要です。',
      '',
      'それでは、最初の質問からお願いします。'
    ].join('\n');
  }

  /* ---------- コピーと遷移 ---------- */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  var SERVICES = {
    chatgpt: {
      label: 'ChatGPT',
      open: function (short) { return 'https://chatgpt.com/?prompt=' + encodeURIComponent(short); },
      note: 'プロンプトをコピーしました。ChatGPTの入力欄に文章が入っていれば、そのまま送信してください。空のときは、貼り付けて送信してください。'
    },
    gemini: {
      label: 'Gemini',
      open: function () { return 'https://gemini.google.com/app'; },
      note: 'プロンプトをコピーしました。Geminiの入力欄に貼り付けて、送信してください。'
    },
    claude: {
      label: 'Claude',
      open: function (short) { return 'https://claude.ai/new?q=' + encodeURIComponent(short); },
      note: 'プロンプトをコピーしました。Claudeの入力欄に文章が入っていれば、そのまま送信してください。空のときは、貼り付けて送信してください。'
    }
  };

  var CHECK_SVG = '<svg class="chk" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';
  var OPEN_DELAY = 750;   // 「コピーしました」を見せてから開くまで（Chromeのクリック有効期間5秒に十分収まる）

  function onClick(key, btn) {
    var svc = SERVICES[key];
    if (!svc || btn.dataset.busy) return;
    btn.dataset.busy = '1';
    var full = buildPrompt(true);    // クリップボード用（説明つき）
    var short = buildPrompt(false);  // URL用（子ページと説明を省いた軽い版）
    copyText(full);
    if (window.SS_BUMP) { try { window.SS_BUMP('cta:ai-erabi:' + key); } catch (e) {} }

    var original = btn.innerHTML;
    btn.innerHTML = CHECK_SVG + 'コピーしました';
    btn.classList.add('copied');
    var note = document.querySelector('.aie-note');
    if (note) {
      note.textContent = svc.note;
      note.classList.add('show');
    }

    setTimeout(function () {
      // noopener指定だと開けても null が返りブロック判定できないため、ここでは付けない
      var w = window.open(svc.open(short), '_blank');
      if (!w && note) {
        // ポップアップがブロックされたときの予備リンク（クリックなら必ず開く）
        note.textContent = svc.note + ' 自動で開かなかったときは → ';
        var a = document.createElement('a');
        a.href = svc.open(short);
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = svc.label + 'を開く';
        note.appendChild(a);
      }
      setTimeout(function () {
        btn.classList.remove('copied');
        btn.innerHTML = original;
        delete btn.dataset.busy;
      }, 1400);
    }, OPEN_DELAY);
  }

  function init() {
    var btns = document.querySelectorAll('[data-ai-erabi]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { onClick(btn.getAttribute('data-ai-erabi'), btn); });
      })(btns[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
