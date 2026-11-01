/* 客語尋寶家（原型）：拍照 → 圈選 → 確認名稱 → 選語言 → 錄音 → 比對 → 收進圖鑑
   原型階段資料只存在本機（localStorage＋IndexedDB），欄位依企劃的 game_* 資料表設計，方便日後接上 Supabase。 */
(()=>{
"use strict";
/* ================= 基本資料 ================= */
const {V:VOCAB,COCO,INET}=window.OBJ_VOCAB;
const CONCEPTS=window.GAME_CONCEPTS,ALBUMS=window.GAME_ALBUMS,S=window.HQScore;
const AUDIO_BASE="https://hakkadict.moe.edu.tw/static/audio/";
const MOBILENET_URL="https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/model.json";
const LIBS=["https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js","https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js"];
const CONSENT_VERSION="proto-2026-11";
const MAX_REC_MS=6000;
const DIAL={
  1:{n:"四縣腔",s:"四",t:{"24":"ˊ","11":"ˇ","31":"ˋ","55":"","2":"ˋ","5":""}},
  2:{n:"海陸腔",s:"海",t:{"53":"ˋ","55":"","24":"ˊ","11":"ˇ","33":"+","5":"","2":"ˋ"}},
  3:{n:"大埔腔",s:"大",t:{"33":"+","31":"^","53":"ˋ","113":"ˇ","21":"^","54":"ˋ","35":"ˊ"}},
  4:{n:"饒平腔",s:"饒",t:{"11":"ˇ","53":"ˋ","55":"","24":"ˊ","2":"ˋ","5":""}},
  5:{n:"詔安腔",s:"詔",t:{"11":"ˇ","31":"^","53":"ˋ","55":"","24":"ˊ","43":"ˋ"}},
  6:{n:"南四縣腔",s:"南",t:{"24":"ˊ","11":"ˇ","31":"ˋ","55":"","2":"ˋ","5":""}}
};
const LANG_NAME={zh:"國語",en:"英語"};
const LEVELS=[[0,"客語新丁"],[300,"客語小師傅"],[1000,"客語師傅"],[3000,"客語先生"],[8000,"老先覺"]];
const PTS={name:10,pass:30,firstTry:10,newItem:20,newLang:20,pending:10,quest:30};

/* ================= 小工具 ================= */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const uuid=()=>crypto.randomUUID?crypto.randomUUID():"x".repeat(32).replace(/x/g,()=>(Math.random()*16|0).toString(16));
function lsGet(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2800)}
const today=()=>dayKey(new Date());
function dayKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function daysBetween(a,b){return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/864e5)}
function weekKey(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return dayKey(x)}
function markPron(p,d){const t=DIAL[d].t;return String(p||"").split(" ").map(s=>{const m=s.match(/^([a-z]+)(\d+)$/);return m?m[1]+(t[m[2]]!=null?t[m[2]]:""):s}).join(" ")}
async function sha256(blob){
  try{const b=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}catch(e){return null}
}
function canvasBlob(c,type,q){return new Promise(r=>c.toBlob(r,type||"image/jpeg",q||.85))}

/* ================= 阿桐（原創吉祥物：油桐花精靈） ================= */
function atongSVG(mood){
  const mouth=mood==="happy"?"M42 58 Q50 68 58 58":mood==="think"?"M44 61 L56 60":"M43 59 Q50 65 57 59";
  const petals=[0,72,144,216,288].map(a=>`<ellipse cx="50" cy="24" rx="17" ry="22" transform="rotate(${a} 50 52)" fill="#fffdf6" stroke="#d9c9a8" stroke-width="2"/>`).join("");
  return `<svg viewBox="0 0 100 100" role="img" aria-label="阿桐">
    <path d="M50 88 Q48 96 40 98" stroke="#5c8a4a" stroke-width="4" fill="none" stroke-linecap="round"/>
    ${petals}
    <circle cx="50" cy="52" r="17" fill="#f2b6a8" stroke="#c0605a" stroke-width="2"/>
    <path d="M50 36 L50 44 M36 47 L43 50 M64 47 L57 50" stroke="#c0605a" stroke-width="2" stroke-linecap="round"/>
    <circle cx="44" cy="52" r="2.6" fill="#1e2f4a"/><circle cx="56" cy="52" r="2.6" fill="#1e2f4a"/>
    <circle cx="39" cy="57" r="2.5" fill="#e98c7d" opacity=".7"/><circle cx="61" cy="57" r="2.5" fill="#e98c7d" opacity=".7"/>
    <path d="${mouth}" stroke="#1e2f4a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  </svg>`;
}

/* ================= 狀態（本機） ================= */
const DEF={v:1,player:{name:"",dialect:1,fs:1,voice:true,consent:null},points:0,ledger:[],collection:{},
  streak:{last:null,days:0,restWeek:null,restUsed:0},quests:null,asrUrl:"",
  data:{captures:[],regions:[],labels:[],recordings:[]}};
let ST=Object.assign({},DEF,lsGet("hq_state",{}));
ST.player=Object.assign({},DEF.player,ST.player||{});
ST.data=Object.assign({},DEF.data,ST.data||{});
const save=()=>lsSet("hq_state",ST);

/* IndexedDB：照片裁切圖與錄音 */
const IDB=(()=>{
  let dbp=null;
  const open=()=>dbp||(dbp=new Promise((res,rej)=>{const r=indexedDB.open("hakka-quest",1);r.onupgradeneeded=()=>r.result.createObjectStore("blobs");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}));
  const tx=async(mode,fn)=>{const db=await open();return new Promise((res,rej)=>{const t=db.transaction("blobs",mode);const q=fn(t.objectStore("blobs"));t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error)})};
  return {put:(k,b)=>tx("readwrite",s=>s.put(b,k)).catch(()=>null),get:k=>tx("readonly",s=>s.get(k)).catch(()=>null),clear:()=>tx("readwrite",s=>s.clear()).catch(()=>null)};
})();

/* ================= 字級、語音導引 ================= */
function applyFont(){document.documentElement.classList.remove("fs1","fs2","fs3");document.documentElement.classList.add("fs"+ST.player.fs)}
let ZH_VOICE=null,EN_VOICE=null;
function pickVoices(){try{const vs=speechSynthesis.getVoices();ZH_VOICE=vs.find(v=>/zh[-_]TW/i.test(v.lang))||vs.find(v=>/^zh/i.test(v.lang))||null;EN_VOICE=vs.find(v=>/^en[-_]US/i.test(v.lang))||vs.find(v=>/^en/i.test(v.lang))||null}catch(e){}}
if("speechSynthesis" in window){pickVoices();speechSynthesis.onvoiceschanged=pickVoices}
function speak(text,lang){
  return new Promise(res=>{
    if(!("speechSynthesis" in window))return res();
    try{
      speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text),v=lang==="en"?EN_VOICE:ZH_VOICE;
      u.lang=v?v.lang:(lang==="en"?"en-US":"zh-TW");if(v)u.voice=v;u.rate=lang==="en"?.85:.9;
      let done=false;const fin=()=>{if(!done){done=true;res()}};
      u.onend=fin;u.onerror=fin;setTimeout(fin,Math.max(2500,text.length*450));
      speechSynthesis.speak(u);
    }catch(e){res()}
  });
}
const player=new Audio();
function playUrl(url){return new Promise(res=>{player.onended=()=>res(true);player.onerror=()=>res(false);player.src=url;player.play().catch(()=>res(false))})}
function stopAudio(){try{speechSynthesis.cancel()}catch(e){}player.pause()}
async function playHakka(h){
  if(!h||!h.a||!h.a.length){toast("這個詞在這個腔調暫時沒有示範錄音");return}
  stopAudio();
  for(const a of h.a){const ok=await playUrl(AUDIO_BASE+a+".mp3");if(!ok){toast("示範錄音播放失敗，請檢查網路");return}await new Promise(r=>setTimeout(r,120))}
}
let GUIDE="";
function guide(text,mood){
  GUIDE=text;$("#guide").classList.toggle("solo",!!main().querySelector(".hero .atong,.result .atong"));$("#guideText").textContent=text;$("#atongMini").innerHTML=atongSVG(mood);
  if(ST.player.voice)speak(text,"zh");
}
$("#btnRelisten").onclick=()=>speak(GUIDE,"zh");

/* ================= 積分、等級、連續天數、任務 ================= */
function level(p){let l=LEVELS[0];for(const x of LEVELS)if(p>=x[0])l=x;const i=LEVELS.indexOf(l),nx=LEVELS[i+1];return {name:l[1],next:nx?nx[0]:null,nextName:nx?nx[1]:null,base:l[0]}}
function addPoints(ev,pts,label,ref){
  if(!pts)return null;
  const row={id:uuid(),t:new Date().toISOString(),ev,pts,label,ref:ref||null};
  ST.ledger.push(row);ST.points+=pts;save();updateBadge();return row;
}
function updateBadge(){$("#ptsBadge").textContent="⭐ "+ST.points.toLocaleString()}
function weekPoints(){const wk=weekKey(new Date());return ST.ledger.filter(r=>weekKey(new Date(r.t))===wk).reduce((s,r)=>s+r.pts,0)}
/* 連續天數：每週可休息 2 天，不歸零 */
function touchStreak(){
  const t=today(),s=ST.streak,wk=weekKey(new Date());
  if(s.restWeek!==wk){s.restWeek=wk;s.restUsed=0}
  if(s.last===t)return;
  if(!s.last)s.days=1;
  else{
    const gap=daysBetween(s.last,t)-1;
    if(gap<=0)s.days++;
    else if(gap<=2-s.restUsed){s.restUsed+=gap;s.days++}
    else s.days=1;
  }
  s.last=t;save();
}
function questsToday(){
  const t=today();
  if(ST.quests&&ST.quests.date===t)return ST.quests;
  const seed=[...t].reduce((a,c)=>a*31+c.charCodeAt(0)>>>0,7);
  const album=ALBUMS[seed%ALBUMS.length];
  ST.quests={date:t,items:[
    {id:"album",title:`今日主題「${album.name}」`,desc:`收集一件${album.sub}`,album:album.id,need:1,have:0,done:false},
    {id:"hak",title:"用客語唸對 2 件東西",desc:"任何腔調都可以",need:2,have:0,done:false},
    {id:"other",title:"用國語或英語唸一件",desc:"可以請孫仔一起來",need:1,have:0,done:false}
  ]};
  save();return ST.quests;
}
function bumpQuest(id,gains){
  const q=questsToday().items.find(x=>x.id===id);
  if(!q||q.done)return;
  q.have++;
  if(q.have>=q.need){q.done=true;const r=addPoints("quest",PTS.quest,"完成任務："+q.title);if(r&&gains)gains.push(r)}
  save();
}
function albumOf(i){const c=VOCAB[i].cat;return ALBUMS.find(a=>a.cats.includes(c))}

/* ================= 畫面切換 ================= */
let HIST=[];
function show(name,opts){
  stopAudio();
  if(!(opts&&opts.replace))HIST.push(name);
  $("#btnBack").classList.toggle("hide",HIST.length<=1);
  window.scrollTo(0,0);
  SCREENS[name](opts||{});
}
$("#btnBack").onclick=()=>{
  if(REC.active)stopRec(true);
  HIST.pop();const prev=HIST.pop()||"home";show(prev);
};
const main=()=>$("#main");
function setTitle(t){$("#title").textContent=t}

/* ================= 影像辨識（TF.js，於手機上執行） ================= */
let coco=null,mnet=null,modelsReady=null;
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error(src));document.head.appendChild(s)})}
function loadModels(){
  if(modelsReady)return modelsReady;
  modelsReady=(async()=>{
    if(!window.tf)await loadScript(LIBS[0]);
    if(!window.cocoSsd)await loadScript(LIBS[1]);
    try{await tf.setBackend("webgl")}catch(e){}
    await tf.ready();
    [coco,mnet]=await Promise.all([cocoSsd.load({base:"lite_mobilenet_v2"}),tf.loadGraphModel(MOBILENET_URL)]);
    tf.tidy(()=>mnet.predict(tf.zeros([1,224,224,3])));
    return true;
  })().catch(e=>{modelsReady=null;throw e});
  return modelsReady;
}
async function classify(canvas){
  const logits=tf.tidy(()=>tf.softmax(mnet.predict(tf.image.resizeBilinear(tf.browser.fromPixels(canvas).toFloat(),[224,224]).div(255).expandDims()).squeeze()));
  const p=await logits.data();logits.dispose();
  const out=[];for(let k=1;k<p.length;k++)if(p[k]>0.02)out.push({idx:k-1,score:p[k]});
  return out.sort((a,b)=>b.score-a.score).slice(0,10);
}
function toCanvas(src,w,h,max){
  const k=Math.min(1,max/Math.max(w,h)),c=document.createElement("canvas");
  c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext("2d").drawImage(src,0,0,c.width,c.height);return c;
}
function crop(full,b,pad,max){
  const x=Math.max(0,b[0]-b[2]*pad),y=Math.max(0,b[1]-b[3]*pad);
  const w=Math.min(full.width-x,b[2]*(1+2*pad)),h=Math.min(full.height-y,b[3]*(1+2*pad));
  const k=Math.min(1,max/Math.max(w,h)),c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));
  c.getContext("2d").drawImage(full,x,y,w,h,0,0,c.width,c.height);return c;
}

/* ================= 一輪尋寶的資料 ================= */
let RUN=null;
/* RUN={capture,full,dets,region,cropCanvas,cands,concept,freeText,labelSource,lang,dialect,attempt,lastRec} */

/* ================= 畫面：首頁 ================= */
const SCREENS={};
SCREENS.home=()=>{
  setTitle("客語尋寶家");HIST=["home"];$("#btnBack").classList.add("hide");
  const lv=level(ST.points),q=questsToday(),got=Object.keys(ST.collection).length,s=ST.streak;
  const prog=lv.next?Math.round((ST.points-lv.base)/(lv.next-lv.base)*100):100;
  const h=new Date().getHours(),hi=h<11?"早安":h<18?"午安":"暗晡安";
  main().innerHTML=`
    <div class="hero"><div class="atong">${atongSVG("happy")}</div>
      <div><h2 style="margin:0">${hi}${ST.player.name?"，"+esc(ST.player.name):""}！</h2>
      <div>${esc(lv.name)}</div><div class="bar" style="margin-top:6px"><i style="width:${prog}%"></i></div>
      <div class="muted">${lv.next?`再 ${lv.next-ST.points} 分升為「${lv.nextName}」`:"已是最高等級"}</div></div></div>
    <div class="stat"><div><b>${ST.points.toLocaleString()}</b>總積分</div><div><b>${s.days||0} 天</b>連續尋寶</div><div><b>${got}／${VOCAB.length}</b>圖鑑</div></div>
    <button class="big accent" id="goHunt">📷 開始尋寶</button>
    <div class="card"><h2 style="margin-top:0">今日任務</h2>
      ${q.items.map(x=>`<div class="quest ${x.done?"done":""}"><div class="ck">${x.done?"✓":x.have+"/"+x.need}</div><div class="q">${esc(x.title)}<small>${esc(x.desc)}・完成 +${PTS.quest} 分</small></div></div>`).join("")}
    </div>
    <div class="row"><button class="big alt" id="goAlbum">📖 圖鑑</button><button class="big alt" id="goRank">🏆 排行榜</button></div>
    <button class="big alt" id="goSet">⚙️ 設定</button>
    ${s.days?`<p class="muted center">每週可以休息 2 天，連續天數不會歸零。本週已休息 ${s.restWeek===weekKey(new Date())?s.restUsed:0} 天。</p>`:""}`;
  $("#goHunt").onclick=()=>show("cam");
  $("#goAlbum").onclick=()=>show("album");
  $("#goRank").onclick=()=>show("rank");
  $("#goSet").onclick=()=>show("settings");
  guide(got?"今天想找什麼寶貝呢？按「開始尋寶」拍一樣東西。":"我是阿桐！拍下身邊的東西，用客語唸出來，就能收進圖鑑。按「開始尋寶」試試看。","happy");
  loadModels().catch(()=>{});
};

/* ================= 畫面：拍照 ================= */
SCREENS.cam=()=>{
  setTitle("拍照");RUN={attempt:0};
  main().innerHTML=`
    <button class="big accent" id="btnSnap" style="min-height:120px;font-size:1.4em">📷 拍下來</button>
    <button class="big alt" id="btnPick">🖼️ 從相簿選照片</button>
    <p class="muted center">照片上傳前會自動去掉拍攝地點等資訊。</p>`;
  $("#btnSnap").onclick=()=>{$("#fileCam").value="";$("#fileCam").click()};
  $("#btnPick").onclick=()=>{$("#fileAlbum").value="";$("#fileAlbum").click()};
  guide("按大按鈕拍一樣東西，也可以從相簿選照片。");
};
function onFile(e){
  const f=e.target.files&&e.target.files[0];if(!f)return;
  const url=URL.createObjectURL(f),img=new Image();
  img.onload=async()=>{
    const full=toCanvas(img,img.naturalWidth,img.naturalHeight,1280);URL.revokeObjectURL(url);
    const blob=await canvasBlob(full,"image/jpeg",.85);   // 重新編碼：不含 EXIF
    RUN={attempt:0,full,capture:{id:uuid(),t:new Date().toISOString(),w:full.width,h:full.height,sha256:await sha256(blob),mime:"image/jpeg"},photoBlob:blob};
    show("select");
  };
  img.onerror=()=>{URL.revokeObjectURL(url);toast("這張照片打不開，請換一張")};
  img.src=url;
}
$("#fileCam").onchange=onFile;$("#fileAlbum").onchange=onFile;

/* ================= 畫面：圈選物品 ================= */
SCREENS.select=()=>{
  if(!RUN||!RUN.full)return show("cam",{replace:true});
  setTitle("圈選物品");
  const url=RUN.full.toDataURL("image/jpeg",.85);
  main().innerHTML=`
    <div class="stage" id="stage"><img src="${url}" alt="剛拍的照片"><canvas id="draw"></canvas><div class="busy" id="busy">阿桐正在找東西…</div></div>
    <button class="big alt" id="btnDraw">✏️ 都不是，我用手指圈</button>
    <button class="big alt" id="btnWhole">🖼️ 用整張照片</button>`;
  const stage=$("#stage"),cv=$("#draw");
  $("#btnWhole").onclick=()=>pickRegion([0,0,RUN.full.width,RUN.full.height],null,"whole",null);
  $("#btnDraw").onclick=()=>startDraw(stage,cv);
  guide("阿桐在照片上畫了框，你想要的東西，用手指點一下框框。","think");
  loadModels().then(async()=>{
    const dets=(await coco.detect(RUN.full,10,0.3)).sort((a,b)=>b.bbox[2]*b.bbox[3]-a.bbox[2]*a.bbox[3]).slice(0,6);
    RUN.dets=dets;$("#busy")&&$("#busy").remove();
    const W=RUN.full.width,H=RUN.full.height;
    dets.forEach((d,k)=>{
      const [x,y,w,h]=d.bbox,i=COCO[d.class],b=document.createElement("button");
      b.className="bx";b.style.cssText=`left:${x/W*100}%;top:${y/H*100}%;width:${w/W*100}%;height:${h/H*100}%`;
      b.innerHTML=`<span>${k+1}</span>`;b.setAttribute("aria-label",`第 ${k+1} 個框`+(i!==undefined?"："+VOCAB[i].zh:""));
      b.onclick=()=>{b.classList.add("on");setTimeout(()=>pickRegion(d.bbox,null,"auto_box",d),150)};
      stage.appendChild(b);
    });
    if(!dets.length)guide("阿桐沒有找到明顯的東西，請用手指在東西外面畫一圈。","think");
  }).catch(()=>{$("#busy")&&($("#busy").textContent="辨識模型載入失敗，請用手指圈選或用整張照片。")});
};
function startDraw(stage,cv){
  stage.querySelectorAll(".bx").forEach(b=>b.remove());
  const r=stage.getBoundingClientRect();cv.width=r.width;cv.height=r.height;
  const ctx=cv.getContext("2d");ctx.lineWidth=6;ctx.lineCap="round";ctx.strokeStyle="#ffd166";
  let pts=[];
  guide("用手指在東西外面畫一圈，畫完放開就好。","think");
  cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);pts=[];ctx.clearRect(0,0,cv.width,cv.height);add(e)};
  const add=e=>{const b=cv.getBoundingClientRect();const p=[(e.clientX-b.left)/b.width,(e.clientY-b.top)/b.height];pts.push(p);
    if(pts.length>1){const a=pts[pts.length-2];ctx.beginPath();ctx.moveTo(a[0]*cv.width,a[1]*cv.height);ctx.lineTo(p[0]*cv.width,p[1]*cv.height);ctx.stroke()}};
  cv.onpointermove=e=>{if(pts.length)add(e)};
  cv.onpointerup=()=>{
    if(pts.length<5){pts=[];return}
    const xs=pts.map(p=>Math.min(1,Math.max(0,p[0]))),ys=pts.map(p=>Math.min(1,Math.max(0,p[1])));
    const x0=Math.min(...xs),y0=Math.min(...ys),x1=Math.max(...xs),y1=Math.max(...ys);
    if((x1-x0)*(y1-y0)<0.01){toast("圈得太小了，請畫大一點");ctx.clearRect(0,0,cv.width,cv.height);pts=[];return}
    const W=RUN.full.width,H=RUN.full.height,step=Math.max(1,Math.floor(pts.length/40));
    const poly=pts.filter((_,k)=>k%step===0).map(p=>[+p[0].toFixed(4),+p[1].toFixed(4)]);
    cv.onpointerdown=cv.onpointermove=cv.onpointerup=null;
    pickRegion([x0*W,y0*H,(x1-x0)*W,(y1-y0)*H],poly,"hand_drawn",null);
  };
}
async function pickRegion(bbox,poly,method,det){
  const W=RUN.full.width,H=RUN.full.height;
  RUN.region={id:uuid(),capture_id:RUN.capture.id,bbox:bbox.map((v,k)=>+(v/(k%2?H:W)).toFixed(4)),polygon:poly,method};
  RUN.cropCanvas=crop(RUN.full,bbox,0.08,512);
  main().innerHTML=`<img class="thumb" src="${RUN.cropCanvas.toDataURL("image/jpeg",.85)}" alt=""><p class="center">阿桐正在認…</p>`;
  let cands=[];
  try{
    await loadModels();
    const cls=await classify(RUN.cropCanvas),best=new Map();
    const add=(i,score,src)=>{const o=best.get(i);if(!o||o.score<score)best.set(i,{i,score:Math.min(1,score+(o?0.15:0)),src})};
    if(det&&COCO[det.class]!==undefined)add(COCO[det.class],det.score,"coco:"+det.class);
    cls.forEach(c=>{const i=INET[String(c.idx)];if(i!==undefined)add(i,c.score*1.1,"imagenet:"+c.idx)});
    if(!det&&method!=="whole"&&RUN.dets)RUN.dets.forEach(d=>{   // 手圈範圍內最大的偵測物也列入參考
      const [x,y,w,h]=d.bbox,ix=Math.max(0,Math.min(x+w,bbox[0]+bbox[2])-Math.max(x,bbox[0])),iy=Math.max(0,Math.min(y+h,bbox[1]+bbox[3])-Math.max(y,bbox[1]));
      if(ix*iy>0.5*w*h&&COCO[d.class]!==undefined)add(COCO[d.class],d.score*.9,"coco:"+d.class);
    });
    cands=[...best.values()].sort((a,b)=>b.score-a.score).slice(0,3);
  }catch(e){}
  RUN.cands=cands;RUN.topk=cands.map(c=>({concept:VOCAB[c.i].zh,score:+c.score.toFixed(3),src:c.src}));
  show("name",{replace:true});
}

/* ================= 畫面：確認名稱 ================= */
SCREENS.name=()=>{
  setTitle("這是什麼？");
  const c=RUN.cands||[];
  main().innerHTML=`
    <img class="thumb" src="${RUN.cropCanvas.toDataURL("image/jpeg",.85)}" alt="圈選的東西">
    <div class="opts">${c.map((x,k)=>`<button class="opt" data-k="${k}"><span class="n">${k+1}</span><span><b>${esc(VOCAB[x.i].zh)}</b><small>${esc((CONCEPTS[VOCAB[x.i].zh]||{en:[""]}).en[0])}</small></span></button>`).join("")}
      <button class="opt other" id="btnOther"><span class="n">？</span><span><b>都不是，我來講</b><small>用說的或打字</small></span></button></div>`;
  main().querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>confirmName(RUN.cands[+b.dataset.k].i,null,+b.dataset.k===0?"model_top1":"model_topk"));
  $("#btnOther").onclick=openOther;
  guide(c.length?`阿桐猜這是「${VOCAB[c[0].i].zh}」。對的話點它，不對就點「都不是，我來講」。`:"阿桐認不出來，請告訴我這是什麼。","think");
  if(!c.length)openOther();
};
function openOther(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  main().innerHTML=`
    <img class="thumb" src="${RUN.cropCanvas.toDataURL("image/jpeg",.85)}" alt="">
    ${SR?`<button class="big accent" id="btnSay">🎙️ 用國語說出名稱</button>`:""}
    <input class="f" id="nameIn" placeholder="或在這裡打字，例如：茶壺" autocomplete="off">
    <div class="sugg" id="sugg"></div>
    <button class="big" id="btnUse" disabled>用這個名稱</button>`;
  const inp=$("#nameIn"),sg=$("#sugg");
  const refresh=()=>{
    const q=inp.value.trim();$("#btnUse").disabled=!q;
    const hits=q?VOCAB.map((v,i)=>({v,i})).filter(x=>x.v.zh.includes(q)||x.v.hk.includes(q)||(CONCEPTS[x.v.zh]||{zh:[]}).zh.some(z=>z.includes(q))).slice(0,8):[];
    sg.innerHTML=hits.map(x=>`<button data-i="${x.i}">${esc(x.v.zh)}</button>`).join("");
  };
  inp.oninput=refresh;
  sg.onclick=e=>{const b=e.target.closest("[data-i]");if(b)confirmName(+b.dataset.i,null,"user_input")};
  $("#btnUse").onclick=()=>{
    const q=inp.value.trim();if(!q)return;
    const i=findConcept(q);
    confirmName(i,i<0?q:null,"user_input",q);
  };
  if(SR)$("#btnSay").onclick=()=>{
    const r=new SR();r.lang="zh-TW";r.interimResults=false;r.maxAlternatives=3;
    $("#btnSay").textContent="🎙️ 請說…";
    r.onresult=e=>{inp.value=S.normZh(e.results[0][0].transcript)||e.results[0][0].transcript;refresh();$("#btnSay").textContent="🎙️ 再說一次"};
    r.onerror=()=>{$("#btnSay").textContent="🎙️ 用國語說出名稱";toast("沒有聽清楚，可以再說一次或打字")};
    r.onend=()=>{if($("#btnSay")&&$("#btnSay").textContent==="🎙️ 請說…")$("#btnSay").textContent="🎙️ 用國語說出名稱"};
    try{r.start()}catch(e){}
  };
  guide("請說出或打出這樣東西的名稱，下面會出現建議，點一下就好。","think");
}
/* 名稱 → 詞彙索引（含同義詞）；找不到回傳 −1 */
function findConcept(q){
  const n=S.normZh(q);
  let i=VOCAB.findIndex(v=>v.zh===n||v.hk===n);
  if(i<0)i=VOCAB.findIndex(v=>(CONCEPTS[v.zh]||{zh:[]}).zh.includes(n));
  return i;
}
function confirmName(i,freeText,source,raw){
  RUN.concept=i;RUN.freeText=freeText;
  const label={id:uuid(),region_id:RUN.region.id,model:"coco-ssd lite_mobilenet_v2 + mobilenet_v2_1.0_224",topk:RUN.topk||[],concept:i>=0?VOCAB[i].zh:null,source,free_text:raw||freeText||null,t:new Date().toISOString()};
  RUN.label=label;
  /* 寫入訓練資料（原型：本機） */
  ST.data.captures.push(RUN.capture);ST.data.regions.push(RUN.region);ST.data.labels.push(label);
  IDB.put("photo:"+RUN.capture.id,RUN.photoBlob);
  canvasBlob(RUN.cropCanvas,"image/jpeg",.85).then(b=>{IDB.put("crop:"+label.id,b);if(i>=0&&!(ST.collection[VOCAB[i].zh]||{}).crop)RUN.cropKey="crop:"+label.id});
  /* 確認名稱 +10：同一物品每日最多 3 次；同一張照片重複上傳不計分 */
  RUN.gains=[];
  const key=i>=0?VOCAB[i].zh:freeText;
  const dup=ST.data.captures.filter(c=>c.sha256&&c.sha256===RUN.capture.sha256).length>1;
  const todayCount=ST.ledger.filter(r=>r.ev==="name"&&r.ref===key&&r.t.slice(0,10)===new Date().toISOString().slice(0,10)).length;
  if(!dup&&todayCount<3){const r=addPoints("name",PTS.name,"確認名稱："+key,key);if(r)RUN.gains.push(r)}
  save();
  show("lang",{replace:true});
}

/* ================= 畫面：選語言 ================= */
SCREENS.lang=()=>{
  setTitle("用哪種話唸？");
  const i=RUN.concept,d=ST.player.dialect,v=i>=0?VOCAB[i]:null;
  const has=x=>v&&v.h[x];
  const name=v?v.zh:RUN.freeText;
  const others=[1,2,3,4,5,6].filter(x=>x!==d);
  main().innerHTML=`
    <img class="thumb" src="${RUN.cropCanvas.toDataURL("image/jpeg",.85)}" alt="">
    <p class="center" style="font-size:1.4em;font-weight:800;margin:8px 0">${esc(name)}</p>
    <div class="langs">
      <button class="opt main" data-l="hak" data-d="${d}"><span><b>客語・${DIAL[d].n}</b><small>${has(d)?esc(v.h[d].w)+"　"+esc(markPron(v.h[d].p,d)):"辭典沒有這個詞，唸你習慣的說法"}</small></span></button>
      ${others.map(x=>`<button class="opt" data-l="hak" data-d="${x}"><span><b>${DIAL[x].n}</b></span></button>`).join("")}
      <button class="opt" data-l="zh"><span><b>國語</b></span></button>
      <button class="opt" data-l="en"><span><b>英語</b></span></button>
    </div>`;
  main().querySelectorAll("[data-l]").forEach(b=>b.onclick=()=>{RUN.lang=b.dataset.l;RUN.dialect=b.dataset.d?+b.dataset.d:null;RUN.attempt=0;show("rec")});
  guide(`你想用哪種話唸「${name}」？平常講${DIAL[d].n}的話，點最上面的大按鈕。`);
};
/* 目前要唸的目標詞 */
function target(){
  const i=RUN.concept,v=i>=0?VOCAB[i]:null,c=v?CONCEPTS[v.zh]:null;
  if(RUN.lang==="hak"){
    const h=v&&v.h[RUN.dialect];
    return {lang:"hak",show:h?h.w:(v?v.hk:RUN.freeText),pron:h?markPron(h.p,RUN.dialect):"",pinyin:h?h.p:"",h,accept:h?[h.w]:(v?[v.hk]:[]),known:!!h};
  }
  if(RUN.lang==="zh")return {lang:"zh",show:v?v.zh:RUN.freeText,pron:v?v.zy:"",accept:c?c.zh:[v?v.zh:RUN.freeText],known:true};
  return {lang:"en",show:c?c.en[0]:"",pron:"",accept:c?c.en:[],known:!!c};
}

/* ================= 畫面：錄音 ================= */
const REC={active:false};
SCREENS.rec=()=>{
  const tg=target(),ln=RUN.lang==="hak"?"客語・"+DIAL[RUN.dialect].n:LANG_NAME[RUN.lang];
  setTitle("唸唸看");
  main().innerHTML=`
    <div class="target"><div class="muted" style="color:inherit">${esc(ln)}</div>
      <div class="w">${esc(tg.show||"（請唸你的說法）")}</div>${tg.pron?`<div class="p">${esc(tg.pron)}</div>`:""}
      ${(tg.lang==="hak"&&tg.h)||tg.lang!=="hak"&&tg.show?`<button class="btn" id="btnDemo" style="margin-top:8px">🔊 聽示範</button>`:""}</div>
    <button class="mic" id="btnMic"><b>🎙️</b><span>點一下開始</span></button>
    <div class="meter"><i id="lvl"></i></div>
    <p class="center muted" id="recMsg">最長 6 秒，唸完再點一下</p>
    <div id="after" class="hide">
      <div class="row"><button class="big alt" id="btnPlay">▶️ 聽我的</button><button class="big alt" id="btnRedo">🔁 重錄</button></div>
      <button class="big accent" id="btnSend">✅ 送出比對</button>
    </div>`;
  const demo=$("#btnDemo");
  if(demo)demo.onclick=()=>tg.lang==="hak"?playHakka(tg.h):speak(tg.show,tg.lang);
  $("#btnMic").onclick=()=>REC.active?stopRec():startRec();
  $("#btnPlay").onclick=()=>{if(RUN.lastRec)playUrl(URL.createObjectURL(RUN.lastRec.blob))};
  $("#btnRedo").onclick=()=>{$("#after").classList.add("hide");startRec()};
  $("#btnSend").onclick=()=>check();
  guide(tg.lang==="hak"&&tg.h?"先聽示範，準備好就點橘色圓鈕，唸完再點一下。":"準備好就點橘色圓鈕開始唸，唸完再點一下。");
};
async function startRec(){
  stopAudio();
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}})}
  catch(e){toast("需要允許使用麥克風才能錄音");return}
  const mime=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(m=>window.MediaRecorder&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(m))||"";
  const mr=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks=[];
  const ac=new (window.AudioContext||window.webkitAudioContext)(),an=ac.createAnalyser();an.fftSize=1024;
  ac.createMediaStreamSource(stream).connect(an);
  const buf=new Float32Array(an.fftSize);
  Object.assign(REC,{active:true,stream,mr,ac,chunks,t0:performance.now(),peak:0,sumRms:0,frames:0,loud:0,transcripts:[]});
  /* 國語、英語：同時用瀏覽器語音辨識（支援的瀏覽器才有） */
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(SR&&RUN.lang!=="hak"){
    try{const r=new SR();r.lang=RUN.lang==="en"?"en-US":"zh-TW";r.interimResults=false;r.maxAlternatives=5;
      r.onresult=e=>{for(const res of e.results)for(const alt of res)REC.transcripts.push(alt.transcript)};
      r.onerror=()=>{};REC.sr=r;REC.srDone=new Promise(res=>{r.onend=res});r.start()}catch(e){REC.sr=null}
  }
  mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  mr.onstop=()=>finishRec();
  mr.start();
  const tick=()=>{
    if(!REC.active)return;
    an.getFloatTimeDomainData(buf);let s=0,p=0;for(const x of buf){s+=x*x;p=Math.max(p,Math.abs(x))}
    const rms=Math.sqrt(s/buf.length);REC.peak=Math.max(REC.peak,p);REC.sumRms+=rms;REC.frames++;if(rms>0.02)REC.loud++;
    const l=$("#lvl");if(l)l.style.width=Math.min(100,rms*400)+"%";
    if(performance.now()-REC.t0>MAX_REC_MS)stopRec();else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const m=$("#btnMic");if(m){m.classList.add("rec");m.innerHTML="<b>⏹️</b><span>唸完點這裡</span>"}
  const msg=$("#recMsg");if(msg)msg.textContent="錄音中…";
}
function stopRec(cancel){
  if(!REC.active)return;
  REC.active=false;REC.cancel=!!cancel;REC.dur=(performance.now()-REC.t0)/1000;
  try{REC.mr.stop()}catch(e){}
  try{REC.sr&&REC.sr.stop()}catch(e){}
  REC.stream.getTracks().forEach(t=>t.stop());
}
async function finishRec(){
  const sr=REC.ac.sampleRate;try{REC.ac.close()}catch(e){}
  if(REC.cancel)return;
  const blob=new Blob(REC.chunks,{type:(REC.mr.mimeType||"audio/webm").split(";")[0]});
  if(REC.srDone)await Promise.race([REC.srDone,new Promise(r=>setTimeout(r,2500))]);
  RUN.attempt++;
  RUN.lastRec={blob,mime:blob.type,sample_rate:sr,duration:+REC.dur.toFixed(2),peak:+REC.peak.toFixed(3),mean_rms:+(REC.sumRms/Math.max(1,REC.frames)).toFixed(4),voiced_ratio:+(REC.loud/Math.max(1,REC.frames)).toFixed(2),transcripts:REC.transcripts.slice()};
  const m=$("#btnMic");if(m){m.classList.remove("rec");m.innerHTML="<b>🎙️</b><span>再錄一次</span>"}
  const msg=$("#recMsg");
  if(RUN.lastRec.peak<0.05||RUN.lastRec.voiced_ratio<0.08){if(msg)msg.textContent="聲音有點小，靠近一點講，再錄一次會比較好。";guide("聲音有點小，靠近手機一點，再錄一次。","think")}
  else if(RUN.lastRec.peak>0.98){if(msg)msg.textContent="聲音太大聲了，離手機遠一點。";guide("聲音太大聲了，離手機遠一點再錄一次。","think")}
  else{if(msg)msg.textContent="錄好了！先聽聽看，再按「送出比對」。";guide("錄好了！可以先聽聽看自己的聲音，再按「送出比對」。","happy")}
  $("#after").classList.remove("hide");
  playUrl(URL.createObjectURL(blob));
}

/* ================= 比對 ================= */
async function check(){
  const tg=target(),r=RUN.lastRec;if(!r)return;
  const rec={id:uuid(),label_id:RUN.label.id,concept:RUN.label.concept,free_text:RUN.freeText,lang:tg.lang,dialect:tg.lang==="hak"?RUN.dialect:null,
    expect:tg.accept[0]||null,expect_pinyin:tg.pinyin||null,mime:r.mime,sample_rate:r.sample_rate,duration:r.duration,peak:r.peak,mean_rms:r.mean_rms,voiced_ratio:r.voiced_ratio,
    attempt:RUN.attempt,device:navigator.userAgent.slice(0,160),asr_model:null,transcript:null,heard_pinyin:null,score:null,auto_verdict:null,final_verdict:null,self_check:null,
    sha256:await sha256(r.blob),consent:ST.player.consent?ST.player.consent.train:false,t:new Date().toISOString()};
  main().innerHTML=`<div class="result pending"><div class="big-icon">🎧</div><p>阿桐認真聽…</p></div>`;
  guide("阿桐認真聽，等一下下。","think");
  /* 1) 有設定語音比對伺服器：送去比對（客語、國語、英語都可） */
  if(ST.asrUrl&&tg.accept.length){
    try{
      const fd=new FormData();
      fd.append("audio",r.blob,"rec."+(r.mime.split("/")[1]||"webm"));
      fd.append("lang",tg.lang);fd.append("dialect",String(rec.dialect||""));
      fd.append("accept",JSON.stringify(tg.accept));fd.append("pinyin",tg.pinyin||"");
      const res=await fetch(ST.asrUrl.replace(/\/$/,"")+"/check",{method:"POST",body:fd});
      if(!res.ok)throw new Error("HTTP "+res.status);
      const j=await res.json();
      Object.assign(rec,{asr_model:j.model||"server",transcript:j.transcript||"",heard_pinyin:j.pinyin||null,score:j.score,auto_verdict:j.verdict});
    }catch(e){toast("語音比對伺服器連不上，改用自己聽聽看");}
  }
  /* 2) 國語、英語：瀏覽器語音辨識的結果 */
  if(!rec.auto_verdict&&tg.lang!=="hak"&&r.transcripts.length&&tg.accept.length){
    let best=null;
    for(const t of r.transcripts){const s=S.scoreTranscript(tg.lang,t,tg.accept);if(!best||s.score>best.score)best=Object.assign({t},s)}
    Object.assign(rec,{asr_model:"browser-webspeech-"+(tg.lang==="en"?"en-US":"zh-TW"),transcript:best.t,score:best.score,auto_verdict:best.verdict});
  }
  RUN.curRec=rec;
  await IDB.put("audio:"+rec.id,r.blob);
  /* 3) 沒有自動比對：先自己聽，標為待驗證 */
  if(!rec.auto_verdict)return show("selfcheck",{replace:true});
  rec.final_verdict=rec.auto_verdict==="pass"?"auto_pass":null;
  ST.data.recordings.push(rec);save();
  if(rec.auto_verdict==="pass")return reward("pass");
  show("unsure",{replace:true});
}
SCREENS.selfcheck=()=>{
  const tg=target();
  setTitle("自己聽聽看");
  main().innerHTML=`
    <div class="result pending"><div class="big-icon">👂</div>
      <p>${tg.lang==="hak"?"客語自動比對還在實測中。":"這支手機不支援自動比對。"}先請你自己比比看：</p></div>
    <div class="row">${(tg.lang==="hak"&&tg.h)||tg.lang!=="hak"&&tg.show?`<button class="big alt" id="btnDemo2">🔊 示範</button>`:""}<button class="big alt" id="btnMine">▶️ 我的</button></div>
    <button class="big accent" id="btnLike">👍 差不多，送出</button>
    <button class="big alt" id="btnAgain">🔁 再唸一次</button>`;
  const d=$("#btnDemo2");if(d)d.onclick=()=>tg.lang==="hak"?playHakka(tg.h):speak(tg.show,tg.lang);
  $("#btnMine").onclick=()=>playUrl(URL.createObjectURL(RUN.lastRec.blob));
  $("#btnLike").onclick=()=>{const rec=RUN.curRec;rec.self_check="similar";rec.final_verdict="pending_review";ST.data.recordings.push(rec);save();reward("pending")};
  $("#btnAgain").onclick=()=>show("rec",{replace:true});
  guide("先聽示範，再聽你自己的。覺得差不多就按「差不多，送出」，阿桐會請大家幫忙確認。");
};
SCREENS.unsure=()=>{
  const rec=RUN.curRec;
  setTitle("再試一次");
  main().innerHTML=`
    <div class="result unsure"><div class="big-icon">🤔</div>
      <p>阿桐聽到的是：<b>「${esc(rec.transcript||"（沒有聽清楚）")}」</b></p>
      <p class="muted" style="color:inherit">唸錯不會扣分，再試一次就好。</p></div>
    <button class="big accent" id="btnRetry">🔁 再唸一次</button>
    <button class="big alt" id="btnRename">✏️ 名稱選錯了，改名稱</button>
    <button class="big alt" id="btnSelf">👂 我覺得我唸對了</button>`;
  $("#btnRetry").onclick=()=>show("rec",{replace:true});
  $("#btnRename").onclick=()=>{RUN.attempt=0;show("name",{replace:true});openOther()};
  $("#btnSelf").onclick=()=>{rec.self_check="disputed";rec.final_verdict="pending_review";save();reward("pending")};
  guide(`阿桐聽到的是「${rec.transcript||"聽不清楚"}」，好像不太一樣。可以再唸一次，或改名稱。`,"think");
};

/* ================= 得分、收進圖鑑 ================= */
function stampKey(){return RUN.lang==="hak"?"hk"+RUN.dialect:RUN.lang}
function reward(kind){
  const gains=RUN.gains||[];RUN.gains=[];
  const key=RUN.concept>=0?VOCAB[RUN.concept].zh:null,sk=stampKey();
  const dupAudio=ST.data.recordings.filter(x=>x.sha256&&x.sha256===RUN.curRec.sha256).length>1;
  if(!dupAudio){
    if(kind==="pass"){
      let r=addPoints("pass",PTS.pass,"唸對了",RUN.curRec.id);if(r)gains.push(r);
      if(RUN.attempt===1){r=addPoints("first_try",PTS.firstTry,"一次就唸對",RUN.curRec.id);if(r)gains.push(r)}
    }else{const r=addPoints("pending",PTS.pending,"錄音已送出，等大家確認",RUN.curRec.id);if(r)gains.push(r)}
  }
  let isNew=false;
  if(key){
    const c=ST.collection[key]||(isNew=true,ST.collection[key]={first:new Date().toISOString(),stamps:{},crop:RUN.cropKey||null,recs:[]});
    if(!c.crop&&RUN.cropKey)c.crop=RUN.cropKey;
    const had=c.stamps[sk];
    if(!had||(had==="wait"&&kind==="pass")){
      if(!had&&!isNew){const r=addPoints("new_lang",PTS.newLang,"新的腔調／語言",key);if(r)gains.push(r)}
      c.stamps[sk]=kind==="pass"?"on":"wait";
    }
    c.recs.push(RUN.curRec.id);
    if(isNew){const r=addPoints("new_item",PTS.newItem,"圖鑑新物品："+key,key);if(r)gains.push(r)}
    const q=questsToday().items.find(x=>x.id==="album");
    if(isNew&&q&&albumOf(RUN.concept)&&albumOf(RUN.concept).id===q.album)bumpQuest("album",gains);
  }
  if(kind==="pass")bumpQuest(RUN.lang==="hak"?"hak":"other",gains);
  touchStreak();save();
  RUN.lastGains={kind,gains,isNew,key};
  show("result",{replace:true});
}
SCREENS.result=()=>{
  const g=RUN.lastGains,tot=g.gains.reduce((s,r)=>s+r.pts,0);
  setTitle(g.kind==="pass"?"唸對了！":"送出了！");
  main().innerHTML=`
    <div class="result ${g.kind==="pass"?"pass":"pending"} pop">
      <div class="atong" style="width:120px;height:120px;margin:0 auto">${atongSVG("happy")}</div>
      <p style="font-size:1.3em;font-weight:800;margin:6px 0">${g.kind==="pass"?"好厲害！":"謝謝你！"}${g.isNew?"「"+esc(g.key)+"」收進圖鑑了":""}</p>
      ${g.kind!=="pass"?`<p class="muted">這筆錄音會請大家和客語老師確認，通過後再補發 ${PTS.pass} 分。</p>`:""}
      <ul class="gain">${g.gains.map(r=>`<li><span>${esc(r.label)}</span><b>+${r.pts}</b></li>`).join("")||`<li><span>這張照片或錄音之前送過了，這次不加分</span><b>0</b></li>`}</ul>
      <p style="font-size:1.4em;font-weight:800">共 +${tot} 分</p>
    </div>
    ${RUN.concept>=0?`<button class="big alt" id="btnOtherLang">🗣️ 用別的話再唸一次</button>`:""}
    <button class="big accent" id="btnNext">📷 再找一件</button>
    <button class="big alt" id="btnHome">🏠 回首頁</button>`;
  const ol=$("#btnOtherLang");if(ol)ol.onclick=()=>{RUN.gains=[];show("lang",{replace:true})};
  $("#btnNext").onclick=()=>show("cam");
  $("#btnHome").onclick=()=>show("home");
  guide(g.kind==="pass"?`唸得真好！這一輪拿到 ${tot} 分。`:`謝謝你！這一輪拿到 ${tot} 分，大家確認後還會再加分。`,"happy");
};

/* ================= 畫面：圖鑑 ================= */
let ALBUM_TAB="zau";
SCREENS.album=()=>{
  setTitle("客家生活圖鑑");
  const items=a=>VOCAB.map((v,i)=>({v,i})).filter(x=>a.cats.includes(x.v.cat));
  const draw=async()=>{
    const a=ALBUMS.find(x=>x.id===ALBUM_TAB),list=items(a),got=list.filter(x=>ST.collection[x.v.zh]).length;
    main().innerHTML=`
      <div class="tabs">${ALBUMS.map(x=>`<button data-a="${x.id}" aria-pressed="${x.id===ALBUM_TAB}">${x.name}</button>`).join("")}</div>
      <p style="margin:10px 0 4px"><b>${a.name}</b>・${a.sub}　${got}／${list.length}</p>
      <div class="bar"><i style="width:${list.length?got/list.length*100:0}%"></i></div>
      <div class="grid">${list.map(x=>{
        const c=ST.collection[x.v.zh];
        const st=[1,2,3,4,5,6].map(d=>`<i class="${c&&c.stamps["hk"+d]==="on"?"on":c&&c.stamps["hk"+d]==="wait"?"wait":""}" title="${DIAL[d].n}">${DIAL[d].s}</i>`).join("")+
          `<i class="${c&&c.stamps.zh?(c.stamps.zh==="on"?"on":"wait"):""}" title="國語">國</i><i class="${c&&c.stamps.en?(c.stamps.en==="on"?"on":"wait"):""}" title="英語">英</i>`;
        return `<div class="item ${c?"":"no"}"><div class="ph" data-crop="${c&&c.crop?esc(c.crop):""}">${c?"":"？"}</div><b>${esc(x.v.zh)}</b><div class="stamps">${st}</div></div>`;
      }).join("")}</div>
      <p class="muted">每個腔調、國語、英語各有一個印章格。實線圈＝唸對了，虛線圈＝等大家確認。</p>`;
    main().querySelectorAll("[data-a]").forEach(b=>b.onclick=()=>{ALBUM_TAB=b.dataset.a;draw()});
    for(const ph of main().querySelectorAll("[data-crop]")){
      const k=ph.dataset.crop;if(!k)continue;
      const b=await IDB.get(k);if(b)ph.innerHTML=`<img src="${URL.createObjectURL(b)}" alt="">`;
    }
  };
  draw();
  const total=Object.keys(ST.collection).length;
  guide(total?`你已經收集 ${total} 樣東西了！每冊集滿會有驚喜。`:"圖鑑還是空的，去拍第一樣東西吧！");
};

/* ================= 畫面：排行榜 ================= */
SCREENS.rank=()=>{
  setTitle("排行榜");
  const me=weekPoints();
  /* 原型：好友資料為示意，正式版接上好友與群組 */
  const demo=[["阿桃姨",Math.max(120,me+80)],["阿明伯",Math.max(90,me+15)],["小孫",Math.max(40,Math.round(me*.6))],["阿珍姊",Math.round(me*.4)+20]];
  const rows=[...demo.map(x=>({nm:x[0],p:x[1]})),{nm:(ST.player.name||"我")+"（我）",p:me,me:true}].sort((a,b)=>b.p-a.p);
  const myNo=rows.findIndex(r=>r.me)+1;
  main().innerHTML=`
    <div class="tabs"><button aria-pressed="true">好友週榜</button><button disabled>群組</button><button disabled>腔調榜</button><button disabled>全國</button></div>
    <ul class="rank" style="margin-top:12px"><li class="me"><span class="no">${myNo}</span><span class="nm">我　本週 ${me} 分</span></li></ul>
    <ul class="rank">${rows.map((r,k)=>`<li class="${r.me?"me":""}"><span class="no">${k+1}</span><span class="nm">${esc(r.nm)}</span><b>${r.p}</b></li>`).join("")}</ul>
    <p class="muted">原型版本的好友名單是示意。正式版可以用 QR Code、邀請碼或 LINE 加好友，也有群組、腔調、縣市和全國排行榜。</p>`;
  guide(`本週你拿到 ${me} 分，排第 ${myNo} 名。加油！`);
};

/* ================= 畫面：設定 ================= */
SCREENS.settings=()=>{
  setTitle("設定");
  const p=ST.player,c=p.consent||{};
  main().innerHTML=`
    <h2>怎麼稱呼你？</h2><input class="f" id="sName" maxlength="20" value="${esc(p.name)}" placeholder="例如：阿桃姨">
    <h2>平常講的腔調</h2><select class="f" id="sDial">${[1,2,3,4,5,6].map(d=>`<option value="${d}" ${d===p.dialect?"selected":""}>${DIAL[d].n}</option>`).join("")}</select>
    <h2>字的大小</h2><div class="seg">${[[1,"標準"],[2,"大"],[3,"特大"]].map(x=>`<button data-fs="${x[0]}" aria-pressed="${p.fs===x[0]}">${x[1]}</button>`).join("")}</div>
    <h2>阿桐講話</h2><div class="seg"><button data-v="1" aria-pressed="${p.voice}">開</button><button data-v="0" aria-pressed="${!p.voice}">關</button></div>
    <h2>資料使用同意</h2>
    <label class="ck"><input type="checkbox" id="cTrain" ${c.train?"checked":""}><span>我同意照片與錄音用來改進客語辨識（訓練資料）</span></label>
    <label class="ck"><input type="checkbox" id="cPublic" ${c.public?"checked":""}><span>我同意別人可以聽我的錄音</span></label>
    <p class="muted">隨時可以取消。取消後，你的資料不會放進下一版的訓練資料。</p>
    <button class="big" id="btnSave">儲存</button>
    <details class="card"><summary>進階（給工作人員）</summary>
      <h2>語音比對伺服器網址</h2><input class="f" id="sAsr" value="${esc(ST.asrUrl)}" placeholder="https://…（沒有就留空）">
      <p class="muted">本機已存 ${ST.data.captures.length} 張照片、${ST.data.recordings.length} 筆錄音的資料。</p>
      <div class="row"><button class="btn" id="btnExport">匯出原型資料（JSON）</button><button class="btn" id="btnReset">清除全部資料</button></div>
    </details>`;
  main().querySelectorAll("[data-fs]").forEach(b=>b.onclick=()=>{p.fs=+b.dataset.fs;applyFont();save();show("settings",{replace:true})});
  main().querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{p.voice=b.dataset.v==="1";save();show("settings",{replace:true})});
  $("#btnSave").onclick=()=>{
    p.name=$("#sName").value.trim();p.dialect=+$("#sDial").value;
    p.consent={version:CONSENT_VERSION,train:$("#cTrain").checked,public:$("#cPublic").checked,at:new Date().toISOString()};
    ST.asrUrl=$("#sAsr").value.trim();save();toast("已儲存");show("home");
  };
  $("#btnExport").onclick=exportData;
  $("#btnReset").onclick=async()=>{if(!confirm("確定要清除這支手機上的全部遊戲資料嗎？"))return;localStorage.removeItem("hq_state");await IDB.clear();location.reload()};
  guide("這裡可以改名字、腔調、字的大小，也可以設定資料要不要拿來改進客語辨識。");
};
function exportData(){
  const out={exported_at:new Date().toISOString(),consent:ST.player.consent,player:{dialect:ST.player.dialect},
    game_captures:ST.data.captures,game_regions:ST.data.regions,game_labels:ST.data.labels,game_recordings:ST.data.recordings,
    game_points_ledger:ST.ledger,note:"照片與錄音檔存在本機 IndexedDB（photo:/crop:/audio: 前綴），此 JSON 只含中繼資料。"};
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:"application/json"}));
  a.download="hakka-quest-"+today()+".json";a.click();
}

/* ================= 第一次使用：同意書 ================= */
SCREENS.welcome=()=>{
  setTitle("歡迎");
  main().innerHTML=`
    <div class="hero" style="justify-content:center"><div class="atong" style="width:140px;height:140px">${atongSVG("happy")}</div></div>
    <p style="font-size:1.2em;font-weight:700" class="center">我是油桐花精靈「阿桐」！</p>
    <p>拍下身邊的東西，用客語唸出來，就能收進你的客家生活圖鑑、得到積分。</p>
    <div class="card">
      <label class="ck"><input type="checkbox" id="wTrain"><span>我同意照片與錄音用來改進客語辨識（可以不勾，一樣可以玩）</span></label>
      <label class="ck"><input type="checkbox" id="wPublic"><span>我同意別人可以聽我的錄音</span></label>
      <p class="muted">照片會去掉拍攝地點。隨時可以在「設定」取消。</p>
    </div>
    <h2>平常講的腔調</h2><select class="f" id="wDial">${[1,2,3,4,5,6].map(d=>`<option value="${d}">${DIAL[d].n}</option>`).join("")}</select>
    <button class="big accent" id="btnStart">開始玩</button>`;
  $("#btnStart").onclick=()=>{
    ST.player.dialect=+$("#wDial").value;
    ST.player.consent={version:CONSENT_VERSION,train:$("#wTrain").checked,public:$("#wPublic").checked,at:new Date().toISOString()};
    save();show("home");
  };
  guide("我是阿桐！先勾選要不要讓錄音幫忙改進客語辨識，不勾也可以玩。再選你平常講的腔調，按「開始玩」。","happy");
};

/* ================= 啟動 ================= */
applyFont();updateBadge();
const qs=new URLSearchParams(location.search);
if(qs.get("asr")){ST.asrUrl=qs.get("asr");save()}
show(ST.player.consent?"home":"welcome");
window.HQ={state:()=>ST,show};   // 方便測試
})();
