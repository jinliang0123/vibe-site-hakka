/* 客語尋寶家：錄音辨識結果與正確名稱的比對評分（瀏覽器與 Node 測試共用）。
   伺服器端 asr/score.py 用同樣的規則。 */
(function(root){
const PASS=0.8,UNSURE=0.5;
function lev(a,b){
  a=[...a];b=[...b];
  if(!a.length)return b.length;if(!b.length)return a.length;
  let prev=Array.from({length:b.length+1},(_,j)=>j);
  for(let i=1;i<=a.length;i++){
    const cur=[i];
    for(let j=1;j<=b.length;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    prev=cur;
  }
  return prev[b.length];
}
/* 1 − 編輯距離 ÷ 較長者長度 */
function sim(a,b){const n=Math.max([...a].length,[...b].length);return n?1-lev(a,b)/n:0}
/* 中文：去掉標點、空白；簡單的簡繁與異體對照 */
const VAR={"台":"臺","车":"車","机":"機","电":"電","视":"視","脑":"腦","鸡":"雞","鸭":"鴨","马":"馬","猪":"豬","鸟":"鳥","鱼":"魚","龟":"龜","蚂":"螞","蚁":"蟻","蝇":"蠅","伞":"傘","钟":"鐘","表":"錶","书":"書","刷":"刷","锅":"鍋","盘":"盤","灯":"燈","帽":"帽","鞋":"鞋","苹":"蘋","萝":"蘿","卜":"蔔","凤":"鳳","梨":"梨","兔":"兔","狮":"獅","猴":"猴","虾":"蝦","蟹":"蟹","蛙":"蛙","蜗":"蝸","蜂":"蜂","蝶":"蝶","鹿":"鹿"};
function normZh(s){return [...String(s||"").replace(/[\s\p{P}\p{S}0-9a-zA-Z]/gu,"")].map(c=>VAR[c]||c).join("")}
function normEn(s){return String(s||"").toLowerCase().replace(/[^a-z ]+/g," ").replace(/\b(a|an|the|this|is|it|that)\b/g," ").replace(/\s+/g," ").trim()}
/* 拼音：數字調，比對時可忽略聲調 */
function sylls(p,keepTone){return String(p||"").toLowerCase().split(/[\s\-]+/).filter(Boolean).map(s=>keepTone?s:s.replace(/\d+$/,""))}
function syllSim(a,b){const x=sylls(a),y=sylls(b);const n=Math.max(x.length,y.length);return n?1-lev(x,y)/n:0}
function verdict(score){return score>=PASS?"pass":score>=UNSURE?"unsure":"fail"}
/* lang: "zh" | "en" | "hak"；accept: 可接受的寫法；pinyin: 客語數字調拼音（只用於 hak） */
function scoreTranscript(lang,transcript,accept,opts){
  opts=opts||{};
  let best=0,match="";
  if(lang==="en"){
    const t=normEn(transcript);
    for(const a of accept){const n=normEn(a);if(!n)continue;const s=(" "+t+" ").includes(" "+n+" ")?1:sim(t,n);if(s>best){best=s;match=a}}
  }else{
    const t=normZh(transcript);
    for(const a of accept){const n=normZh(a);if(!n)continue;const s=t.includes(n)?1:sim(t,n);if(s>best){best=s;match=a}}
    if(lang==="hak"&&opts.pinyin&&opts.heardPinyin){
      const ps=syllSim(opts.heardPinyin,opts.pinyin);
      if(ps>best){best=ps;match=opts.pinyin}
    }
  }
  best=Math.round(best*100)/100;
  return {score:best,verdict:verdict(best),match};
}
const API={lev,sim,normZh,normEn,sylls,syllSim,verdict,scoreTranscript,PASS,UNSURE};
if(typeof module!=="undefined"&&module.exports)module.exports=API;else root.HQScore=API;
})(typeof window!=="undefined"?window:globalThis);
