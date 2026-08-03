/* まちづくりラボ 共通スクリプト  © School Stock */

/* クイズの答えを開く */
function ans(b){
  var t = b.nextElementSibling;
  if(!t) return;
  t.style.display = "block";
  b.style.display = "none";
}

/* かんがえメモ（この端末のブラウザにだけ残る） */
var MEMO_KEY = "machidukuri-memos";

function getMemos(){
  try { return JSON.parse(localStorage.getItem(MEMO_KEY)) || []; }
  catch(e){ return []; }
}
function saveMemos(m){
  try { localStorage.setItem(MEMO_KEY, JSON.stringify(m)); } catch(e){}
}
function esc(s){
  return String(s).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];
  });
}
function renderMemos(){
  var list = document.getElementById("memoList");
  if(!list) return;
  var m = getMemos();
  if(!m.length){
    list.innerHTML = '<p class="note">まだ メモが ありません。</p>';
    return;
  }
  list.innerHTML = m.map(function(x,i){
    return '<div class="memoItem"><div><span class="d">'+esc(x.d)+'</span>'+esc(x.t)+
           '</div><button onclick="delMemo('+i+')" aria-label="このメモをけす">けす</button></div>';
  }).reverse().join("");
}
function addMemo(){
  var el = document.getElementById("memoIn");
  if(!el || !el.value.trim()) return;
  var m = getMemos();
  m.push({ d: new Date().toLocaleDateString("ja-JP"), t: el.value.trim() });
  saveMemos(m); el.value = ""; renderMemos();
}
function delMemo(i){
  var m = getMemos(); m.splice(i,1); saveMemos(m); renderMemos();
}
function copyAll(){
  var txt = getMemos().map(function(x){ return "【"+x.d+"】"+x.t; }).join("\n");
  if(!txt){ alert("まだ メモが ないよ"); return; }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){
      alert("コピーしたよ。先生の フォームなどに はりつけよう");
    });
  } else {
    var ta = document.createElement("textarea");
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); alert("コピーしたよ"); } catch(e){}
    document.body.removeChild(ta);
  }
}

document.addEventListener("DOMContentLoaded", renderMemos);
