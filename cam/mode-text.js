/* 認文字模式：Tesseract.js 辨識照片中的客語漢字，上方顯示漢字＋拼音並發音，下方顯示辭典解釋 */
const TXT=(()=>{
const LIB="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const OCR_LANG="https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_tra@1.0.0/4.0.0_best_int";
const DICT_URL="../hakkaocr/dict.json";
const SRC_NOTE=["教育部《臺灣客語辭典》整詞錄音","拼音依《臺灣客家語常用詞辭典》，錄音逐字播放","辭典沒有收這個詞，依單字音組合，僅供參考"];
let OPT=Object.assign({sound:true,pinyin:true},lsGet("cam_opt",{}));   // 自動發音、顯示拼音
let CUR=null;   // {img,blob,canvas,w,h,lines,pick,text,box,chars,sel,anchor,adjust,frame,typed}

/* 依序播放一串錄音檔；segs=[{a:[檔名]}]，段與段之間稍微停頓 */
async function playSegs(segs,btn){
  stopAll();const tok=playToken;markBtn(btn);
  const list=segs.filter(s=>s.a&&s.a.length);
  if(!list.length){toast("這段文字在"+DN(DIALECT)+"暫時沒有錄音");markBtn(null);return}
  if(list.length<segs.length)toast("部分字詞在此腔調沒有錄音，已略過");
  for(const s of list){
    for(const a of s.a){
      if(tok!==playToken)return;
      const ok=await playOne(auUrl(a),tok);
      if(!ok){if(tok===playToken){toast("客語錄音播放失敗，請檢查網路");markBtn(null)}return}
      if(s.a.length>1)await new Promise(r=>setTimeout(r,80));
    }
    await new Promise(r=>setTimeout(r,280));
  }
  if(tok===playToken)markBtn(null);
}

/* ================= 辭典 ================= */
/* dict.json：{詞:[[拼音×6, 錄音×6 或含 # 的樣板, [釋義], [例句], 詞性, 來源], ...]} */
let DB=null,MAXW=1,dbReady=null;
function loadDict(){
  if(dbReady)return dbReady;
  dbReady=fetch(DICT_URL).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}).then(j=>{
    DB=j;MAXW=Math.max(...Object.keys(j).map(k=>[...k].length));return j;
  }).catch(e=>{dbReady=null;throw e});
  return dbReady;
}
const rdAudio=(r,d)=>typeof r[1]==="string"?r[1].replace("#",d):r[1][d-1];
/* 單字在某腔調的讀音：可指定要的拼音（找相同音的錄音） */
function charReading(c,d,want){
  const rs=DB[c]||[];
  const cand=rs.filter(r=>r[0][d-1]&&!/ /.test(r[0][d-1]));
  const hit=want?cand.find(r=>r[0][d-1]===want&&rdAudio(r,d)):(cand.find(r=>rdAudio(r,d))||cand[0]);
  return hit?{p:hit[0][d-1],a:rdAudio(hit,d)}:null;
}
/* 把一段文字切成辭典詞（動態規劃：盡量用長詞） */
function segment(text){
  const cs=[...text],n=cs.length,best=Array(n+1).fill(-1),from=Array(n+1).fill(0);best[0]=0;
  for(let i=0;i<n;i++){
    if(best[i]<0)continue;
    for(let L=1;L<=Math.min(MAXW,n-i);L++){
      const w=cs.slice(i,i+L).join("");
      const known=DB[w]&&HAN.test(cs[i]);
      if(L>1&&!known)continue;
      const sc=best[i]+(known?L*L:0);
      if(sc>best[i+L]){best[i+L]=sc;from[i+L]=i}
    }
  }
  const out=[];let j=n;
  while(j>0){const i=from[j];out.unshift(cs.slice(i,j).join(""));j=i}
  // 相鄰的非漢字合併（標點、數字）
  const segs=[];
  out.forEach(w=>{const han=HAN.test(w);const last=segs[segs.length-1];if(!han&&last&&!last.han)last.w+=w;else segs.push({w,han})});
  return segs;
}
/* 某詞在某腔調的讀音與錄音：s=0 整詞錄音、1 常用詞辭典拼音逐字錄音、2 單字組合 */
function hakkaOf(w,d){
  const rs=DB[w]||[];
  const r=rs.find(r=>r[0][d-1]&&rdAudio(r,d))||rs.find(r=>r[0][d-1]);
  if(r){
    const p=r[0][d-1],au=rdAudio(r,d);
    if(au)return {w,p,a:[au],s:0,r};
    const syl=p.split(" "),cs=[...w];
    let a=[];
    if(syl.length===cs.length){a=cs.map((c,i)=>{const x=charReading(c,d,syl[i]);return x&&x.a});if(!a.every(Boolean))a=[]}
    return {w,p,a,s:1,r};
  }
  const cs=[...w],ps=[],as=[];
  for(const c of cs){const x=charReading(c,d);if(!x)return {w,p:"",a:[],s:2,r:null};ps.push(x.p);if(x.a)as.push(x.a)}
  return {w,p:ps.join(" "),a:as.length===cs.length?as:[],s:2,r:null};
}
function analyze(text,d){
  return segment(text).map(sg=>sg.han?Object.assign({han:true},hakkaOf(sg.w,d)):{w:sg.w,han:false,p:"",a:[],s:-1});
}
function shortGloss(segs){
  for(const s of segs){if(s.r&&s.r[2]&&s.r[2][0])return (s.w+"："+s.r[2][0]).slice(0,200)}
  return "";
}

/* ================= 結果畫面 ================= */
/* 上方：客語漢字＋拼音（可關）＋發音；中間：照片；下方：辭典解釋 */
function resultHTML(text,d,photo,opts){
  opts=opts||{};
  const segs=analyze(text,d);
  const top=segs.map((s,k)=>{
    if(!s.han)return `<span class="seg punct">${esc(s.w)}</span>`;
    const cs=[...s.w],syl=s.p?markPron(s.p,d).split(" "):[];
    const per=syl.length===cs.length;
    return `<button class="seg ${s.s===2?"guess":""}" data-seg="${k}" title="點一下播放「${esc(s.w)}」">${cs.map((c,i)=>`<span class="ch"><span class="c">${esc(c)}</span>${OPT.pinyin?`<span class="r">${per?esc(syl[i]):""}</span>`:""}</span>`).join("")}${OPT.pinyin&&!per&&s.p?`<span class="r whole">${esc(markPron(s.p,d))}</span>`:""}</button>`;
  }).join("");
  const hanSegs=segs.filter(s=>s.han);
  const raw=hanSegs.map(s=>s.p||"？").join("　");
  const noAudio=hanSegs.some(s=>!s.a.length);
  return `<div class="hk top">
      <div class="chips dsel" role="group" aria-label="選擇腔調">${[1,2,3,4,5,6].map(x=>`<button class="chip" data-dl="${x}" aria-pressed="${x===d}">${DN(x).replace("腔","")}</button>`).join("")}</div>
      <div class="word">${top||`<span class="muted">（沒有文字）</span>`}</div>
      ${OPT.pinyin?`<div class="muted">${esc(raw)}</div>`:""}
      <div class="row" style="justify-content:center;margin-top:6px">
        <button class="say" data-say="all">🔊 客語發音</button>
        <button class="chip" data-opt="sound" aria-pressed="${OPT.sound}">自動發音：${OPT.sound?"開":"關"}</button>
        <button class="chip" data-opt="pinyin" aria-pressed="${OPT.pinyin}">拼音：${OPT.pinyin?"開":"關"}</button>
      </div>
      ${noAudio?`<div class="note">部分字詞在${DN(d)}沒有錄音或讀音，播放時會略過。</div>`:""}
    </div>
    ${photo}
    ${opts.extra||""}
    <div class="defs">${defsHTML(segs,d)}</div>`;
}
function readingHTML(r,d,main){
  const p=r[0][d-1];
  const defs=r[2]||[],exs=r[3]||[];
  return `<div class="rd${main?"":" alt"}">
    <div class="rdh">${p?`<b>${esc(markPron(p,d))}</b> <span class="muted">${esc(p)}</span>`:`<span class="muted">${DN(d)}無此讀音</span>`}${r[4]?` <span class="pos">${esc(r[4])}</span>`:""}</div>
    ${defs.length?`<ol>${defs.map(x=>`<li>${esc(x)}</li>`).join("")}</ol>`:""}
    ${exs.length?`<div class="ex">${exs.map(x=>`<div>例：${esc(x)}</div>`).join("")}</div>`:""}
  </div>`;
}
function defsHTML(segs,d){
  const seen=new Set(),cards=[];
  segs.forEach((s,k)=>{
    if(!s.han||seen.has(s.w)||cards.length>=12)return;seen.add(s.w);
    const link=`<a href="${MOEDICT}${encodeURIComponent(s.w)}" target="_blank" rel="noopener">萌典</a>`;
    let body;
    if(s.r){
      const rs=DB[s.w];
      body=rs.map(r=>readingHTML(r,d,r===s.r)).join("");
    }else{
      body=`<p class="note">辭典沒有收「${esc(s.w)}」這個詞，以下是單字解釋：</p>`+
        [...s.w].map(c=>{const rs=DB[c]||[];return `<div class="sub"><b class="big">${esc(c)}</b>${rs.length?rs.slice(0,2).map((r,i)=>readingHTML(r,d,i===0)).join(""):`<p class="muted">辭典查無此字。</p>`}</div>`}).join("");
    }
    cards.push(`<div class="def" id="def-${k}"><div class="lab"><span class="dw">${esc(s.w)}</span><span>${s.s>=0?SRC_NOTE[s.s]+"・":""}${link}</span></div>${body}</div>`);
  });
  return cards.length?`<h3 class="dh">📖 辭典解釋</h3>`+cards.join(""):"";
}
/* 綁定結果畫面的按鈕；onChange(新腔調, 是否播放) 由呼叫者重畫 */
function bindResult(root,text,d,onChange){
  const segs=analyze(text,d);
  const all=root.querySelector("[data-say=all]");
  if(all)all.onclick=()=>{unlockAudio();playSegs(segs.filter(s=>s.han),all)};
  root.querySelectorAll("[data-seg]").forEach(b=>b.onclick=()=>{
    unlockAudio();const s=segs[+b.dataset.seg];
    playSegs([s],b);
    const el=root.querySelector("#def-"+b.dataset.seg)||[...root.querySelectorAll(".def")].find(x=>x.querySelector(".dw").textContent===s.w);
    if(el){el.classList.add("flash");setTimeout(()=>el.classList.remove("flash"),1200)}
  });
  root.querySelectorAll("[data-dl]").forEach(b=>b.onclick=()=>{unlockAudio();onChange(+b.dataset.dl,true)});
  root.querySelectorAll("[data-opt]").forEach(b=>b.onclick=()=>{OPT[b.dataset.opt]=!OPT[b.dataset.opt];lsSet("cam_opt",OPT);onChange(d,false)});
}
const autoSay=root=>{if(OPT.sound){const b=root.querySelector("[data-say=all]");if(b)b.click()}};

/* ================= 文字辨識（Tesseract.js，繁體中文；切到此模式才下載） ================= */
let worker=null,ocrReady=null;
function load(){
  if(ocrReady)return ocrReady;
  loadDict().catch(()=>toast("辭典載入失敗，請檢查網路"));
  ocrReady=(async()=>{
    try{
      if(!window.Tesseract)await new Promise((res,rej)=>{const s=document.createElement("script");s.src=LIB;s.onload=res;s.onerror=()=>rej(new Error("文字辨識程式庫載入失敗"));document.head.appendChild(s)});
      worker=await Tesseract.createWorker("chi_tra",1,{langPath:OCR_LANG,logger:m=>{
        if(APP.mode==="text"&&m.status&&/loading|initializ/.test(m.status)&&m.progress<1)$("#modelMsg").textContent="文字辨識程式載入中… "+Math.round((m.progress||0)*100)+"%";
      }});
      if(APP.mode==="text")$("#modelMsg").textContent="準備好了！把客語文字放進黃色框框裡，按下拍照鍵。";
      return true;
    }catch(e){
      console.warn(e);ocrReady=null;
      if(APP.mode==="text")$("#modelMsg").textContent="文字辨識程式載入失敗，請檢查網路後重新整理頁面。";
      throw e;
    }
  })();
  return ocrReady;
}
/* 縮放到指定倍率並轉灰階、拉高對比 */
function prepCanvas(src,s){
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(src.width*s));c.height=Math.max(1,Math.round(src.height*s));
  const g=c.getContext("2d");g.imageSmoothingQuality="high";g.drawImage(src,0,0,c.width,c.height);
  const im=g.getImageData(0,0,c.width,c.height),px=im.data,hist=new Uint32Array(256);
  for(let i=0;i<px.length;i+=4){const y=(px[i]*299+px[i+1]*587+px[i+2]*114)/1000|0;px[i]=y;hist[y]++}
  const tot=px.length/4;let lo=0,hi=255,acc=0;
  for(;lo<255;lo++){acc+=hist[lo];if(acc>tot*.02)break}
  acc=0;for(;hi>0;hi--){acc+=hist[hi];if(acc>tot*.02)break}
  const k=hi>lo?255/(hi-lo):1;
  for(let i=0;i<px.length;i+=4){const v=Math.max(0,Math.min(255,(px[i]-lo)*k));px[i]=px[i+1]=px[i+2]=v}
  g.putImageData(im,0,0);return c;
}
/* 一次辨識：回傳每一行的漢字、信心度、字高（原圖像素）與位置（0~1） */
async function ocrPass(src,scale,psm){
  const pc=prepCanvas(src,scale);
  await worker.setParameters({tessedit_pageseg_mode:psm});
  const {data}=await worker.recognize(pc,{},{blocks:true,text:false});
  const lines=[];
  (data.blocks||[]).forEach(b=>b.paragraphs.forEach(p=>p.lines.forEach(l=>{
    const sy=[];
    l.words.forEach(w=>w.symbols.forEach(s=>{const t=(s.text||"").trim();if(t&&HAN.test(t))sy.push({t,c:s.confidence,b:s.bbox})}));
    if(!sy.length)return;
    const conf=sy.reduce((a,s)=>a+s.c,0)/sy.length;
    if(conf<45||(sy.length===1&&sy[0].c<70))return;   // 雜訊
    const hs=sy.map(s=>s.b.y1-s.b.y0).sort((a,b)=>a-b),h=hs[hs.length>>1]/scale;
    const x0=Math.min(...sy.map(s=>s.b.x0)),y0=Math.min(...sy.map(s=>s.b.y0)),x1=Math.max(...sy.map(s=>s.b.x1)),y1=Math.max(...sy.map(s=>s.b.y1));
    const W=pc.width,H=pc.height,pad=.01;
    lines.push({text:sy.map(s=>s.t).join(""),syms:sy.map(s=>({t:s.t,c:Math.round(s.c),b:[s.b.x0/W,s.b.y0/H,(s.b.x1-s.b.x0)/W,(s.b.y1-s.b.y0)/H]})),conf,h,
      box:[Math.max(0,x0/W-pad),Math.max(0,y0/H-pad),Math.min(1,(x1-x0)/W+2*pad),Math.min(1,(y1-y0)/H+2*pad)]});
  })));
  return lines;
}
/* 結果好壞：辭典裡找得到的多字詞加分，再乘上信心度 */
function passScore(lines){
  let s=0;
  lines.forEach(l=>{let v=0;segment(l.text).forEach(g=>{if(!g.han)return;const L=[...g.w].length;v+=L>1?L*1.5:(DB[g.w]?.6:.2)});s+=v*l.conf/100});
  return s;
}
/* 同一張圖用不同大小、版面模式辨識幾次，取最好的結果（字太大或太小都會降低準確度） */
async function ocr(canvas,onStep){
  await load();
  const W=canvas.width,H=canvas.height;
  const s1=Math.min(2,Math.max(1,900/Math.min(W,H)));
  onStep&&onStep(1);
  let best=await ocrPass(canvas,s1,"3"),bestS=passScore(best);
  const domH=best.length?Math.max(...best.map(l=>l.h)):0;
  const targets=domH?[44,30]:[0,0];
  for(let k=0;k<targets.length;k++){
    const avg=best.length?best.reduce((a,l)=>a+l.conf,0)/best.length:0;
    if(best.length&&avg>=90&&k>0)break;
    const sc=targets[k]?Math.min(2,Math.max(.15,targets[k]/domH)):(k?500:800)/Math.max(W,H);
    onStep&&onStep(k+2);
    const r=await ocrPass(canvas,sc,"11"),rs=passScore(r);
    if(rs>bestS){best=r;bestS=rs}
  }
  const lines=best;
  if(!lines.length)return lines;
  // 字最大（最顯眼）的幾行依由上而下合成主要結果，其餘列為候選
  const maxH=Math.max(...lines.map(l=>l.h));
  const big=lines.filter(l=>l.h>=maxH*.8).sort((a,b)=>a.box[1]-b.box[1]);
  const rest=lines.filter(l=>!big.includes(l)).sort((a,b)=>b.h-a.h);
  const out=big.length>1?[mergeLines(big)].concat(big,rest):big.concat(rest);
  return out.slice(0,8);
}
function mergeLines(ls){
  const x0=Math.min(...ls.map(l=>l.box[0])),y0=Math.min(...ls.map(l=>l.box[1]));
  const x1=Math.max(...ls.map(l=>l.box[0]+l.box[2])),y1=Math.max(...ls.map(l=>l.box[1]+l.box[3]));
  return {text:ls.map(l=>l.text).join("").slice(0,30),syms:[].concat(...ls.map(l=>l.syms)),conf:ls.reduce((a,l)=>a+l.conf,0)/ls.length,h:ls[0].h,box:[x0,y0,x1-x0,y1-y0],merged:true};
}

/* ================= 相機取景：只取黃色取景框附近 ================= */
/* 相機畫面是 object-fit:cover，先算出畫面上看得到的範圍 */
function grab(v){
  const vw=v.videoWidth,vh=v.videoHeight,r=v.clientWidth/v.clientHeight;
  let sw=vw,sh=vh;if(vw/vh>r)sw=vh*r;else sh=vw/r;
  // 只取取景框（寬 84%、高 40%）四周再多留一點
  const cx=(vw-sw)/2+sw*.04,cy=(vh-sh)/2+sh*.26,cw=sw*.92,ch=sh*.48;
  const full=document.createElement("canvas");full.width=Math.round(cw);full.height=Math.round(ch);
  full.getContext("2d").drawImage(v,cx,cy,cw,ch,0,0,full.width,full.height);
  return toCanvas(full,full.width,full.height,1280);
}
async function handle(c){
  const img=c.toDataURL("image/jpeg",.85);
  $("#resBox").appendChild($("#acts"));
  $("#res").innerHTML=`${photoHTML(img)}<div class="busy"><div class="spin"></div>辨識文字中…</div>`;
  APP.setActs(false);
  let lines=[];
  const step=k=>{const b=$("#res .busy");if(b)b.innerHTML=`<div class="spin"></div>辨識文字中…（${k}/3）`};
  try{await loadDict();lines=await ocr(c,step)}catch(e){console.warn(e);$("#res").querySelector(".busy").textContent="辨識程式或辭典載入失敗，請檢查網路後再試一次。";return}
  const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",.82));
  CUR={img,blob,canvas:c,w:c.width,h:c.height,pick:-1};
  setLines(lines);
  APP.logActivity("text","scan");
  render(true);
}
/* 不拍照，直接輸入文字 */
async function handleText(t){
  t=t.trim();if(!t)return false;
  try{await loadDict()}catch(e){toast("辭典載入失敗，請檢查網路");return false}
  if(!HAN.test(t)){toast("請輸入漢字");return false}
  const c=document.createElement("canvas");c.width=900;c.height=Math.round(900*.5);
  const g=c.getContext("2d");g.fillStyle="#fffdf8";g.fillRect(0,0,c.width,c.height);
  g.fillStyle="#2b2a26";const fs=Math.min(200,Math.floor(820/Math.max(1,[...t].length)));
  g.font=`700 ${fs}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;g.textAlign="center";g.textBaseline="middle";g.fillText(t,c.width/2,c.height/2);
  const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",.85));
  CUR={img:c.toDataURL("image/jpeg",.85),blob,w:c.width,h:c.height,lines:[],pick:-1,text:t,box:null,typed:true};
  return true;
}
/* ================= 在照片上挑字 ================= */
/* 辨識出的每個字（依行由上而下、行內由左而右），可直接點選 */
function setLines(lines){
  CUR.lines=lines;CUR.pick=lines.length?0:-1;CUR.anchor=null;CUR.sel=null;
  CUR.text=lines.length?lines[0].text:"";CUR.box=lines.length?lines[0].box:null;
  const real=lines.filter(l=>!l.merged).sort((a,b)=>a.box[1]-b.box[1]);
  CUR.chars=[].concat(...real.map(l=>l.syms.filter(s=>s.b).slice().sort((a,b)=>a.b[0]-b.b[0])));
}
function unionBox(bs){
  const x0=Math.min(...bs.map(b=>b[0])),y0=Math.min(...bs.map(b=>b[1])),x1=Math.max(...bs.map(b=>b[0]+b[2])),y1=Math.max(...bs.map(b=>b[1]+b[3])),pad=.01;
  return [Math.max(0,x0-pad),Math.max(0,y0-pad),Math.min(1-Math.max(0,x0-pad),x1-x0+2*pad),Math.min(1-Math.max(0,y0-pad),y1-y0+2*pad)];
}
/* 點一個字＝查那個字；再點另一個字＝選取兩字之間整段；第三次點又重新開始 */
function tapChar(i){
  if(CUR.anchor==null){CUR.anchor=i;CUR.sel=[i,i]}
  else{CUR.sel=[Math.min(CUR.anchor,i),Math.max(CUR.anchor,i)];CUR.anchor=null}
  const cs=CUR.chars.slice(CUR.sel[0],CUR.sel[1]+1);
  CUR.text=cs.map(c=>c.t).join("").slice(0,30);CUR.box=unionBox(cs.map(c=>c.b));CUR.pick=-1;
  APP.resetFav();
  render(true);
}
function pickPhotoHTML(){
  const inSel=i=>CUR.sel&&i>=CUR.sel[0]&&i<=CUR.sel[1];
  const cb=CUR.adjust?"":(CUR.chars||[]).map((c,i)=>`<button class="cbox${inSel(i)?" on":""}${CUR.anchor===i?" anchor":""}" data-ci="${i}" aria-label="${esc(c.t)}" style="left:${pct(c.b[0])};top:${pct(c.b[1])};width:${pct(c.b[2])};height:${pct(c.b[3])}"></button>`).join("");
  const box=!CUR.adjust&&CUR.box?`<div class="box" style="left:${pct(CUR.box[0])};top:${pct(CUR.box[1])};width:${pct(CUR.box[2])};height:${pct(CUR.box[3])}"></div>`:"";
  const f=CUR.frame;
  const frame=CUR.adjust?`<div class="frame" id="frame" style="left:${pct(f[0])};top:${pct(f[1])};width:${pct(f[2])};height:${pct(f[3])}">${["nw","ne","sw","se"].map(k=>`<i class="hd ${k}" data-h="${k}"></i>`).join("")}</div>`:"";
  const tools=!CUR.canvas?"":CUR.adjust
    ?`<div class="note">拖曳黃框移動位置，拉四個角調整大小，框住要查的字。</div><div class="row" style="justify-content:center;margin-top:6px"><button class="btn pri sm" id="frGo">🔍 辨識框內文字</button><button class="btn sm" id="frCancel">取消</button></div>`
    :`<div class="note">${(CUR.chars||[]).length?"👆 點照片上的字來挑選：點一個字查單字，再點另一個字就選取中間整段。":""}認不準時可以用「✂️ 調整黃框」框住要查的字再辨識一次。</div><div class="row" style="justify-content:center;margin-top:6px"><button class="btn sm" id="frOpen">✂️ 調整黃框</button></div>`;
  return `<div class="photo"><div class="pin" id="pin"><img src="${CUR.img}" alt="">${box}${cb}${frame}</div></div>${tools}`;
}
function bindPick(){
  $("#res").querySelectorAll("[data-ci]").forEach(b=>b.onclick=e=>{e.stopPropagation();unlockAudio();tapChar(+b.dataset.ci)});
  const op=$("#frOpen");if(op)op.onclick=()=>{
    const b=CUR.box||[.15,.35,.7,.3],m=.03;
    CUR.frame=[Math.max(0,b[0]-m),Math.max(0,b[1]-m),Math.min(1,b[2]+2*m),Math.min(1,b[3]+2*m)];
    CUR.frame[2]=Math.min(CUR.frame[2],1-CUR.frame[0]);CUR.frame[3]=Math.min(CUR.frame[3],1-CUR.frame[1]);
    CUR.adjust=true;render(false);
  };
  const cc=$("#frCancel");if(cc)cc.onclick=()=>{CUR.adjust=false;render(false)};
  const go=$("#frGo");if(go)go.onclick=reOcrFrame;
  const fr=$("#frame");if(fr)dragFrame(fr,$("#pin"));
}
/* 黃框：拖曳移動、拉角縮放（滑鼠與觸控都可） */
function dragFrame(fr,pin){
  let st=null;
  fr.onpointerdown=e=>{
    e.preventDefault();fr.setPointerCapture(e.pointerId);
    const r=pin.getBoundingClientRect();
    st={h:e.target.dataset.h||"move",x:e.clientX,y:e.clientY,W:r.width,H:r.height,f:CUR.frame.slice()};
  };
  fr.onpointermove=e=>{
    if(!st)return;
    const dx=(e.clientX-st.x)/st.W,dy=(e.clientY-st.y)/st.H,MIN=.06;
    let [x,y,w,h]=st.f;
    if(st.h==="move"){x=Math.max(0,Math.min(1-w,x+dx));y=Math.max(0,Math.min(1-h,y+dy))}
    else{
      let x1=x+w,y1=y+h;
      if(st.h.includes("w"))x=Math.max(0,Math.min(x1-MIN,x+dx));else x1=Math.min(1,Math.max(x+MIN,x1+dx));
      if(st.h.includes("n"))y=Math.max(0,Math.min(y1-MIN,y+dy));else y1=Math.min(1,Math.max(y+MIN,y1+dy));
      w=x1-x;h=y1-y;
    }
    CUR.frame=[x,y,w,h];
    Object.assign(fr.style,{left:pct(x),top:pct(y),width:pct(w),height:pct(h)});
  };
  fr.onpointerup=fr.onpointercancel=()=>{st=null};
}
/* 只辨識黃框內的範圍，再把位置換回整張照片的座標 */
async function reOcrFrame(){
  const [fx,fy,fw,fh]=CUR.frame,src=CUR.canvas;
  // 框內影像四周補上背景色的空白邊，貼邊的字才認得準
  const cw=Math.max(1,Math.round(fw*src.width)),ch=Math.max(1,Math.round(fh*src.height)),pd=Math.round(Math.max(cw,ch)*.2);
  const c=document.createElement("canvas");c.width=cw+2*pd;c.height=ch+2*pd;
  const g=c.getContext("2d");
  g.drawImage(src,fx*src.width,fy*src.height,cw,ch,pd,pd,cw,ch);
  const px=g.getImageData(pd,pd,cw,ch).data;let r=0,gg=0,bb=0,n=0;
  for(let x=0;x<cw;x++)for(const y of [0,ch-1]){const i=(y*cw+x)*4;r+=px[i];gg+=px[i+1];bb+=px[i+2];n++}
  for(let y=0;y<ch;y++)for(const x of [0,cw-1]){const i=(y*cw+x)*4;r+=px[i];gg+=px[i+1];bb+=px[i+2];n++}
  g.fillStyle=`rgb(${r/n|0},${gg/n|0},${bb/n|0})`;
  g.fillRect(0,0,c.width,pd);g.fillRect(0,pd+ch,c.width,pd);g.fillRect(0,pd,pd,ch);g.fillRect(pd+cw,pd,pd,ch);
  const go=$("#frGo");go.disabled=true;go.textContent="辨識中…";
  let lines=[];
  try{lines=await ocr(c,k=>{go.textContent=`辨識中…（${k}/3）`})}catch(e){toast("辨識失敗，請再試一次");go.disabled=false;go.textContent="🔍 辨識框內文字";return}
  if(!lines.length){toast("框內找不到清楚的字，請調整黃框再試");go.disabled=false;go.textContent="🔍 辨識框內文字";return}
  const sx=c.width/cw,sy=c.height/ch,ox=pd/c.width,oy=pd/c.height;   // 去掉補邊、換回整張照片的座標
  const mp=b=>[fx+(b[0]-ox)*sx*fw,fy+(b[1]-oy)*sy*fh,b[2]*sx*fw,b[3]*sy*fh];
  lines.forEach(l=>{l.box=mp(l.box);l.syms.forEach(s=>{if(s.b)s.b=mp(s.b)})});
  // 框外原本認到的字保留，仍可點選
  const inF=bx=>{const cx=bx[0]+bx[2]/2,cy=bx[1]+bx[3]/2;return cx>=fx&&cx<=fx+fw&&cy>=fy&&cy<=fy+fh};
  const keep=CUR.lines.filter(l=>!l.merged&&!inF(l.box)).map(l=>Object.assign({},l,{syms:l.syms.filter(s=>!s.b||!inF(s.b))})).filter(l=>l.syms.length);
  CUR.adjust=false;setLines(lines.concat(keep));
  APP.resetFav();
  render(true);
}
function render(autoplay){
  if(!CUR)return;
  $("#resBox").appendChild($("#acts"));   // 動作按鈕先移出，畫完再放到照片下方
  const lowConf=CUR.pick>=0?CUR.lines[CUR.pick].syms.filter(s=>s.c<70).map(s=>s.t):[];
  const alts=CUR.lines.length>1?`<div class="note">照片裡的其他文字：</div><div class="chips">${CUR.lines.map((l,k)=>`<button class="chip" data-line="${k}" aria-pressed="${k===CUR.pick}">${esc(l.text.length>12?l.text.slice(0,12)+"…":l.text)}</button>`).join("")}</div>`:"";
  const edit=`<div id="actSlot"></div><div class="fix">
      ${alts}
      <label class="f" for="fixIn">${CUR.typed?"查詢的文字":"辨識結果"}（認錯字可以直接修改）</label>
      <div class="row"><input class="f grow" id="fixIn" maxlength="30" value="${esc(CUR.text)}" style="width:auto"><button class="btn" id="fixGo">更新</button></div>
      ${lowConf.length?`<div class="note">「${esc(lowConf.join("、"))}」比較沒把握，請確認是否正確。</div>`:""}
    </div>`;
  if(!CUR.text){
    $("#res").innerHTML=`${pickPhotoHTML()}<p class="empty">照片裡找不到清楚的中文字 😅<br>請靠近一點、對準文字、避免反光或模糊再拍一次，<br>或在下面直接輸入文字。</p>${edit}`;
  }else{
    $("#res").innerHTML=resultHTML(CUR.text,DIALECT,pickPhotoHTML(),{extra:edit});
    bindResult($("#res"),CUR.text,DIALECT,(nd,play)=>{setDialect(nd);render(play)});
  }
  $("#actSlot").appendChild($("#acts"));
  APP.setActs(!!CUR.text,true);
  bindPick();
  const fx=()=>{const v=$("#fixIn").value.trim();if(!v||!HAN.test(v)){toast("請輸入客語漢字");return}CUR.text=v;CUR.sel=null;CUR.anchor=null;CUR.pick=CUR.lines.findIndex(l=>l.text===v);CUR.box=CUR.pick>=0?CUR.lines[CUR.pick].box:null;APP.resetFav();render(true)};
  $("#fixGo").onclick=fx;$("#fixIn").onkeydown=e=>{if(e.key==="Enter")fx()};
  $("#res").querySelectorAll("[data-line]").forEach(b=>b.onclick=()=>{CUR.pick=+b.dataset.line;CUR.sel=null;CUR.anchor=null;CUR.text=CUR.lines[CUR.pick].text;CUR.box=CUR.lines[CUR.pick].box;APP.resetFav();render(true)});
  if(autoplay&&CUR.text&&!CUR.adjust)autoSay($("#res"));
}

/* ================= 我的最愛（給共用模組呼叫） ================= */
function favRow(){
  if(!CUR||!CUR.text)return null;
  const segs=analyze(CUR.text,DIALECT).filter(s=>s.han);
  return {kind:"text",word:CUR.text.slice(0,60),ocr_text:(CUR.lines||[]).map(l=>l.text).join("\n").slice(0,2000)||null,
    pron:segs.map(s=>s.p).join(" ").trim()||null,gloss:shortGloss(segs)||null,box:CUR.box};
}
const favTitle=f=>f.word||"";
const favSub=f=>markPron(f.pron||"",f.dialect);
/* 收藏詳細內容（我的最愛、群組相簿、複習共用） */
async function view(f,d,src){
  try{await loadDict()}catch(e){return {html:`${photoHTML(src,f.box)}<p class="empty">辭典載入失敗，請檢查網路。<br>${esc(f.word)}　${esc(markPron(f.pron||"",f.dialect))}</p>`,bind(){},play(){}}}
  return {
    html:`<div class="res">${resultHTML(f.word,d,photoHTML(src,f.box))}</div>`,
    bind:(root,onDialect)=>bindResult(root,f.word,d,(nd,play)=>onDialect(nd,play)),
    play:root=>autoSay(root)
  };
}
/* 回報錯誤表單的預設值 */
function contribDefaults(){
  if(!CUR)return null;
  const segs=CUR.text?analyze(CUR.text,DIALECT).filter(s=>s.han):[];
  const pron=segs.map(s=>s.p).join(" ").trim();
  return {img:CUR.img,blob:CUR.blob,box:CUR.box,hanzi:CUR.text||"",pinyin:pron,orig_text:CUR.text||(CUR.lines||[]).map(l=>l.text).join(" ")||"",orig_pron:pron};
}
return {key:"text",load,loadDict,grab,handle,handleText,render,favRow,favTitle,favSub,view,contribDefaults,reset(){CUR=null},has:()=>!!CUR};
})();
