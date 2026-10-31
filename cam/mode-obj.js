/* 認物件模式：TensorFlow.js（COCO-SSD＋MobileNet v2）辨識物品，國語在照片上方、客語在照片下方 */
const OBJ=(()=>{
const DICT="https://hakkadict.moe.edu.tw/search_result?id=";
const MOBILENET_URL="https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/model.json";
const LIBS=["https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js","https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js"];
const SRC_NOTE=["教育部《臺灣客語辭典》整詞錄音","拼音依《臺灣客家語常用詞辭典》，錄音為逐字播放","依單字音組合，僅供參考，錄音為逐字播放"];
const {V:VOCAB,COCO,INET}=window.OBJ_VOCAB;
let CUR=null;   // {img,blob,canvas,w,h,cands:[{i,score,box,label}],pick,manual}

/* 一個字一個音節的排版（音節數不同時整串放下方） */
function charsHTML(word,syl){
  const cs=[...word];
  if(syl&&syl.length===cs.length)return `<div class="word">${cs.map((c,i)=>`<span class="ch"><span class="c">${esc(c)}</span><span class="r">${esc(syl[i])}</span></span>`).join("")}</div>`;
  return `<div class="word">${cs.map(c=>`<span class="ch"><span class="c">${esc(c)}</span></span>`).join("")}</div>`+(syl?`<div class="pron">${esc(syl.join(" "))}</div>`:"");
}

/* ================= 發音 ================= */
let ZH_VOICE=null;
function pickVoice(){
  try{
    const vs=speechSynthesis.getVoices();
    ZH_VOICE=vs.find(v=>/zh[-_]TW/i.test(v.lang))||vs.find(v=>/zh[-_](Hant|HK)/i.test(v.lang))||vs.find(v=>/^zh/i.test(v.lang))||null;
  }catch(e){}
}
if("speechSynthesis" in window){pickVoice();speechSynthesis.onvoiceschanged=pickVoice}
function sayZh(text,tok){
  return new Promise(res=>{
    if(!("speechSynthesis" in window)){toast("這個瀏覽器不支援國語語音");return res()}
    const u=new SpeechSynthesisUtterance(text);
    u.lang=ZH_VOICE?ZH_VOICE.lang:"zh-TW";if(ZH_VOICE)u.voice=ZH_VOICE;u.rate=.85;
    let done=false;const fin=()=>{if(!done){done=true;res()}};
    u.onend=fin;u.onerror=fin;
    setTimeout(fin,Math.max(2500,text.length*900));   // 部分瀏覽器不觸發 onend
    speechSynthesis.cancel();speechSynthesis.speak(u);
  });
}
async function sayHk(h,tok){
  if(!h||!h.a||!h.a.length){toast("這個詞在此腔調暫時沒有錄音");return}
  for(const a of h.a){
    if(tok!==playToken)return;
    const ok=await playOne(auUrl(a),tok);
    if(!ok){toast("客語錄音播放失敗，請檢查網路");return}
    if(h.a.length>1)await new Promise(r=>setTimeout(r,120));
  }
}
async function playBoth(zh,h,btnZh,btnHk){
  stopAll();const tok=playToken;
  markBtn(btnZh);await sayZh(zh,tok);
  if(tok!==playToken)return;
  await new Promise(r=>setTimeout(r,350));
  if(tok!==playToken)return;
  markBtn(btnHk);await sayHk(h,tok);
  if(tok===playToken)markBtn(null);
}
async function playZh(zh,btn){stopAll();const tok=playToken;markBtn(btn);await sayZh(zh,tok);if(tok===playToken)markBtn(null)}
async function playHk(h,btn){stopAll();const tok=playToken;markBtn(btn);await sayHk(h,tok);if(tok===playToken)markBtn(null)}

/* ================= 詞彙資料 ================= */
/* 取得某詞在某腔調的客語資料；該腔調沒有時回傳 null */
const hkOf=(i,d)=>{const v=VOCAB[i];return v&&v.h[d]||null};
function hkView(i,d,pronOverride){
  const v=VOCAB[i],h=hkOf(i,d);
  if(!h)return {h:null,word:v?v.hk:"",syl:null};
  return {h,word:h.w,syl:markPron(pronOverride||h.p,d).split(" ")};
}

/* ================= 影像辨識（切到此模式才下載模型） ================= */
let coco=null,mnet=null,modelsReady=null;
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("載入失敗："+src));document.head.appendChild(s)})}
function load(){
  if(modelsReady)return modelsReady;
  modelsReady=(async()=>{
    try{
      if(!window.tf)await loadScript(LIBS[0]);
      if(!window.cocoSsd)await loadScript(LIBS[1]);
      if(!window.tf||!window.cocoSsd)throw new Error("模型程式庫載入失敗");
      try{await tf.setBackend("webgl")}catch(e){}
      await tf.ready();
      [coco,mnet]=await Promise.all([cocoSsd.load({base:"lite_mobilenet_v2"}),tf.loadGraphModel(MOBILENET_URL)]);
      // 先暖機一次，第一次辨識才不會卡
      tf.tidy(()=>mnet.predict(tf.zeros([1,224,224,3])));
      if(APP.mode==="object")$("#modelMsg").textContent="辨識模型已就緒，對準物品按下拍照鍵。";
      return true;
    }catch(e){
      console.warn(e);modelsReady=null;
      if(APP.mode==="object")$("#modelMsg").textContent="辨識模型載入失敗，請檢查網路後重新整理頁面。";
      throw e;
    }
  })();
  return modelsReady;
}
async function classify(canvas){
  const logits=tf.tidy(()=>{
    const x=tf.image.resizeBilinear(tf.browser.fromPixels(canvas).toFloat(),[224,224]).div(255).expandDims();
    return tf.softmax(mnet.predict(x).squeeze());
  });
  const p=await logits.data();logits.dispose();
  const out=[];
  for(let k=1;k<p.length;k++)if(p[k]>0.02)out.push({idx:k-1,score:p[k]});   // 第 0 類是背景
  return out.sort((a,b)=>b.score-a.score).slice(0,10);
}
async function recognize(canvas){
  await load();
  const [det,cls]=await Promise.all([coco.detect(canvas,10,0.3),classify(canvas)]);
  const best=new Map();   // 詞彙索引 → 候選
  const add=(i,score,box,label)=>{const o=best.get(i);if(!o||o.score<score)best.set(i,{i,score,box:box||(o&&o.box)||null,label})};
  // 物體偵測：面積大的物體加權，避免背景小東西蓋過主角
  const area=canvas.width*canvas.height;
  det.forEach(d=>{const i=COCO[d.class];if(i===undefined)return;const a=d.bbox[2]*d.bbox[3]/area;add(i,d.score*(0.6+0.4*Math.min(1,a*3)),d.bbox,d.class)});
  cls.forEach(c=>{const i=INET[c.idx];if(i===undefined)return;const o=best.get(i);add(i,Math.min(1,c.score*1.1+(o?0.15:0)),o&&o.box,"imagenet:"+c.idx)});
  // 人通常只是背景，有其他物體時往後排
  const arr=[...best.values()].sort((a,b)=>b.score-a.score);
  const pi=VOCAB.findIndex(v=>v.zh==="人");
  if(arr.length>1&&arr[0].i===pi&&arr[1].score>0.25)arr.push(arr.shift());
  return arr.slice(0,6);
}

/* ================= 相機取景：整個畫面 ================= */
function grab(v){return toCanvas(v,v.videoWidth,v.videoHeight,1024)}
async function handle(c){
  $("#resBox").appendChild($("#acts"));
  $("#res").innerHTML=`${photoHTML(c.toDataURL("image/jpeg",.85))}<div class="busy"><div class="spin"></div>辨識中…</div>`;
  APP.setActs(false);
  let cands=[];
  try{cands=await recognize(c)}catch(e){$("#res").querySelector(".busy").textContent="辨識模型載入失敗，請檢查網路後再試一次。";return}
  const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",.82));
  CUR={canvas:c,img:c.toDataURL("image/jpeg",.85),blob,w:c.width,h:c.height,cands,pick:cands.length?0:-1,manual:null};
  APP.logActivity("object","scan");
  render(true);
}
function curIdx(){return CUR.manual!=null?CUR.manual:(CUR.pick>=0?CUR.cands[CUR.pick].i:-1)}
/* 物品框（換算成 0~1） */
function curBox(){
  const b=CUR.manual==null&&CUR.pick>=0?CUR.cands[CUR.pick].box:null;
  return b?[b[0]/CUR.w,b[1]/CUR.h,b[2]/CUR.w,b[3]/CUR.h].map(x=>Math.round(Math.max(0,Math.min(1,x))*1e4)/1e4):null;
}
function render(autoplay){
  if(!CUR)return;
  const i=curIdx();
  $("#resBox").appendChild($("#acts"));
  const alts=CUR.cands.map((c,k)=>`<button class="chip" data-k="${k}" aria-pressed="${CUR.manual==null&&k===CUR.pick}">${esc(VOCAB[c.i].zh)} ${Math.round(c.score*100)}%</button>`).join("");
  if(i<0){
    $("#res").innerHTML=`${photoHTML(CUR.img)}
      <p class="empty">看不出這是什麼 😅<br>試著靠近一點、讓物品佔滿畫面，或手動選擇。<br>如果詞彙表裡沒有這個物品，歡迎按「🎙️ 提供客語資料」告訴我們它的客語怎麼說。</p>
      <div class="row" style="justify-content:center"><button class="btn" id="btnManual">✏️ 手動選擇物品</button></div>`;
    APP.setActs(false,true);$("#btnManual").onclick=openPicker;return;
  }
  const v=VOCAB[i];
  $("#res").innerHTML=resultHTML(v,i,DIALECT,photoHTML(CUR.img,curBox()))+
    `<div class="note" style="margin-top:12px">不是這個嗎？其他可能：</div>
     <div class="chips" id="alts">${alts}<button class="chip" id="btnManual">✏️ 手動選擇</button></div>`;
  bindResult($("#res"),i,DIALECT);
  $("#alts").onclick=e=>{const b=e.target.closest("[data-k]");if(!b)return;CUR.pick=+b.dataset.k;CUR.manual=null;APP.resetFav();render(true)};
  $("#btnManual").onclick=openPicker;
  APP.setActs(true,true);
  if(autoplay)$("#res").querySelector("[data-say=both]").click();
}
/* 國語在影像上方、客語在影像下方 */
function resultHTML(v,i,d,photo,pron){
  const hv=hkView(i,d,pron);
  const zhSyl=v.zy.split(" ");
  let hkPart;
  if(hv.h){
    const link=hv.h.id?`<a href="${DICT}${hv.h.id}" target="_blank" rel="noopener">查辭典</a>`:`<a href="${MOEDICT}${encodeURIComponent(hv.word)}" target="_blank" rel="noopener">查辭典</a>`;
    hkPart=`${charsHTML(hv.word,hv.syl)}
      <div class="muted">${esc(hv.h.p)}</div>
      <div class="row" style="justify-content:center;margin-top:6px"><button class="say" data-say="hk">🔊 客語</button><button class="say" data-say="both">▶️ 國語＋客語</button></div>
      <div class="note">${SRC_NOTE[hv.h.s]}${hv.h.a.length?"":"（此腔調暫無錄音）"}・${link}</div>`;
  }else{
    const has=Object.keys(v.h).map(Number);
    hkPart=`${charsHTML(v.hk,null)}<div class="note">辭典資料中沒有「${esc(v.hk)}」的${DN(d)}讀音。${has.length?"可改選："+has.map(x=>`<button class="chip" data-dl="${x}">${DN(x)}</button>`).join(" "):"這個詞暫時沒有客語資料。"}</div>
      <div class="row" style="justify-content:center;margin-top:6px"><button class="say" data-say="both">▶️ 國語</button></div>`;
  }
  return `<div class="zh"><div class="lab"><span>國語</span><button class="say" data-say="zh">🔊 國語</button></div>${charsHTML(v.zh,zhSyl)}</div>
    ${photo}
    <div class="hk"><div class="lab"><span>客語・${DN(d)}</span><span class="chips" data-dsel>${[1,2,3,4,5,6].map(x=>`<button class="chip" data-dl="${x}" aria-pressed="${x===d}" ${v.h[x]?"":"style='opacity:.45'"}>${DN(x).replace("腔","")}</button>`).join("")}</span></div>${hkPart}</div>`;
}
function bindResult(root,i,d,onDialect){
  const v=VOCAB[i];
  root.querySelectorAll("[data-say]").forEach(b=>b.onclick=()=>{
    unlockAudio();
    const h=hkOf(i,d),k=b.dataset.say;
    if(k==="zh")playZh(v.zh,b);
    else if(k==="hk")playHk(h,b);
    else if(!h)playZh(v.zh,b);
    else playBoth(v.zh,h,root.querySelector("[data-say=zh]"),root.querySelector("[data-say=hk]")||b);
  });
  root.querySelectorAll("[data-dl]").forEach(b=>b.onclick=()=>{
    const nd=+b.dataset.dl;
    if(onDialect)return onDialect(nd);
    setDialect(nd);render(false);
    const h=hkOf(i,nd);if(h)playHk(h,$("#res [data-say=hk]"));
  });
}
function openPicker(){
  const cats=[...new Set(VOCAB.map(v=>v.cat))];
  openModal(`<h2>手動選擇物品 <button class="btn sm ghost" data-close>✕</button></h2>
    <input class="f" id="pkQ" placeholder="搜尋國語或客語，例如：狗、車" autocomplete="off">
    <div id="pkList"></div>`);
  const draw=()=>{
    const q=$("#pkQ").value.trim();
    $("#pkList").innerHTML=cats.map(c=>{
      const items=VOCAB.map((v,i)=>({v,i})).filter(x=>x.v.cat===c&&(!q||x.v.zh.includes(q)||x.v.hk.includes(q)));
      return items.length?`<p class="muted" style="margin:12px 0 4px">${c}</p><div class="pick">${items.map(x=>`<button data-i="${x.i}">${esc(x.v.zh)}<small>${esc(x.v.hk)}</small></button>`).join("")}</div>`:"";
    }).join("")||`<p class="empty">找不到，目前收錄 ${VOCAB.length} 種常見物品。<br>可以關閉視窗後按「🎙️ 提供客語資料」新增這個物品。</p>`;
  };
  draw();$("#pkQ").oninput=draw;
  $("#pkList").onclick=e=>{const b=e.target.closest("[data-i]");if(!b)return;CUR.manual=+b.dataset.i;closeModal();APP.resetFav();render(true)};
}

/* ================= 我的最愛（給共用模組呼叫） ================= */
function favRow(){
  const i=curIdx();if(i<0)return null;
  const v=VOCAB[i],h=hkOf(i,DIALECT);
  const c=CUR.manual==null&&CUR.pick>=0?CUR.cands[CUR.pick]:null;
  return {kind:"object",word:(h?h.w:v.hk).slice(0,60),pron:h?h.p:null,zh:v.zh,zhuyin:v.zy,concept:i,label:c?c.label:"manual",box:curBox()};
}
const favTitle=f=>`${f.zh||""}・${f.word||""}`;
const favSub=f=>"";
/* 收藏詳細內容（我的最愛、群組相簿、複習共用） */
async function view(f,d,src){
  const i=f.concept;
  const v=VOCAB[i]&&VOCAB[i].zh===f.zh?VOCAB[i]:null;
  const photo=photoHTML(src,f.box);
  if(!v)return {html:`<div class="zh"><div class="lab"><span>國語</span></div>${charsHTML(f.zh||"",(f.zhuyin||"").split(" "))}</div>${photo}<div class="hk">${charsHTML(f.word||"",f.pron?markPron(f.pron,f.dialect).split(" "):null)}</div>`,bind(){},play(){}};
  return {
    html:resultHTML(v,i,d,photo,d===f.dialect&&f.pron?f.pron:null),
    bind:(root,onDialect)=>bindResult(root,i,d,nd=>{onDialect(nd);const h=hkOf(i,nd);if(h)setTimeout(()=>playHk(h,root.querySelector("[data-say=hk]")),50)}),
    play:root=>{const b=root.querySelector("[data-say=both]");if(b)b.click()}
  };
}
/* 投稿表單的預設值 */
function contribDefaults(){
  if(!CUR)return null;
  const i=curIdx(),v=i>=0?VOCAB[i]:null,h=i>=0?hkOf(i,DIALECT):null;
  const c=CUR.manual==null&&CUR.pick>=0?CUR.cands[CUR.pick]:null;
  return {img:CUR.img,blob:CUR.blob,box:curBox(),zh:v?v.zh:"",hanzi:h?h.w:(v?v.hk:""),pinyin:h?h.p:"",concept:i>=0?i:null,label:c?c.label:(i>=0?"manual":null)};
}
return {key:"object",VOCAB,load,grab,handle,render,favRow,favTitle,favSub,view,contribDefaults,reset(){CUR=null},has:()=>!!CUR};
})();
