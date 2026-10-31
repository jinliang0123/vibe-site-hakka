/* 拍照學客語（合併版）主程式：模式切換、相機、腔調、帳號、我的最愛、複習、群組、投稿與回報 */

/* ================= 狀態 ================= */
const MODES={object:OBJ,text:TXT};
let PROFILE=null;                 // cam_profiles
let DIALECT=lsGet("cam_dialect",1);
let FAVS=[];                      // 我的最愛（兩種模式）
let GROUPS=[];                    // [{id,name,join_code,owner_id,role}]
let IS_ADMIN=false;
let curTab="vCam";
const urlMode=new URLSearchParams(location.search).get("mode");
const APP={
  mode:MODES[urlMode]?urlMode:(MODES[lsGet("cam_mode","object")]?lsGet("cam_mode","object"):"object"),
  /* 結果畫面下方按鈕：fav=可收藏、contrib=可投稿／回報 */
  setActs(fav,contrib){
    const b=$("#btnFav");
    if(!b.dataset.saved)b.disabled=!fav;
    $("#btnContrib").disabled=!contrib;
  },
  resetFav(){const b=$("#btnFav");delete b.dataset.saved;b.textContent="⭐ 加入我的最愛"},
  /* 練習紀錄（登入時才記） */
  logActivity(kind,action,ref){
    if(!AUTH)return;
    api("cam_activity",{method:"POST",body:{kind,action,ref:ref||null}}).catch(()=>{});
  }
};
const M=()=>MODES[APP.mode];

/* ================= 相機 ================= */
let stream=null,facing="environment",camWanted=false;
function toCanvas(src,w,h,max){
  const s=Math.min(1,(max||1280)/Math.max(w,h));
  const c=document.createElement("canvas");c.width=Math.round(w*s);c.height=Math.round(h*s);
  c.getContext("2d").drawImage(src,0,0,c.width,c.height);return c;
}
async function openCam(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){$("#camMsg").innerHTML="這個瀏覽器無法直接開相機，<br>請按下方「📸 用手機內建相機拍照」或「相簿」。";$("#snapBtn").classList.add("pri");return false}
  try{
    if(stream)stream.getTracks().forEach(t=>t.stop());
    const res=APP.mode==="text"?1920:1280;
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:res},height:{ideal:res}},audio:false});
    const v=$("#video");v.srcObject=stream;await v.play().catch(()=>{});
    $("#camMsg").classList.add("hide");$("#aim").classList.toggle("hide",APP.mode!=="text");
    $("#btnShoot").setAttribute("aria-label","拍照");return true;
  }catch(e){
    console.warn(e);
    $("#camMsg").classList.remove("hide");
    $("#camMsg").innerHTML=camHelp(e.name);
    $("#snapBtn").classList.add("pri");
    return false;
  }
}
/* 相機打不開時，依原因說明怎麼處理；也可以改用手機內建相機（不需要網頁權限） */
function camHelp(name){
  const ua=navigator.userAgent,ios=/iPhone|iPad|iPod/.test(ua);
  const inApp=/Line\/|FBAN|FBAV|Instagram|Messenger|MicroMessenger/i.test(ua);
  let how;
  if(inApp)how="你是從 LINE／Facebook 等 App 裡開啟的，這類內建瀏覽器常會擋相機。<br>請按右上角選單「用瀏覽器開啟」（Safari 或 Chrome）。";
  else if(name==="NotAllowedError"||name==="SecurityError")how=ios
    ?"相機權限被拒絕了。請到 iPhone「設定 → Safari → 相機」選「允許」，<br>或點網址列左邊的「ᴀA」→「網站設定」→ 相機 →「允許」，再重新整理。"
    :"相機權限被拒絕了。請點網址列左邊的 🔒 圖示 →「權限」→ 相機 →「允許」，再重新整理。";
  else if(name==="NotReadableError"||name==="AbortError")how="相機正被其他 App 使用中，請先關閉其他用到相機的 App 再試一次。";
  else if(name==="NotFoundError"||name==="OverconstrainedError")how="找不到可以使用的相機。";
  else how="無法開啟相機（"+esc(name||"錯誤")+"）。";
  return how+"<br><br>也可以按下方「📸 用手機內建相機拍照」，<br>不需要網頁相機權限。";
}
function stopCam(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}$("#aim").classList.add("hide")}
async function fromVideo(){
  const v=$("#video");
  if(!stream||!v.videoWidth){const ok=await openCam();if(!ok)return null;await new Promise(r=>setTimeout(r,400))}
  if(!v.videoWidth)return null;
  return M().grab(v);
}
function fromFile(file){
  return new Promise((res,rej)=>{
    const img=new Image();const url=URL.createObjectURL(file);
    img.onload=()=>{const c=toCanvas(img,img.naturalWidth,img.naturalHeight,APP.mode==="text"?1280:1024);URL.revokeObjectURL(url);res(c)};
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("讀不到這張照片"))};
    img.src=url;
  });
}
function showResult(){stopAll();$("#resBox").appendChild($("#acts"));$("#camBox").classList.add("hide");$("#resBox").classList.remove("hide");APP.resetFav()}
async function handleCanvas(c){showResult();stopCam();await M().handle(c)}
function backToCam(){
  stopAll();OBJ.reset();TXT.reset();
  $("#resBox").classList.add("hide");$("#camBox").classList.remove("hide");APP.resetFav();
  if(camWanted)openCam();
}

/* ================= 模式切換 ================= */
const MODE_UI={
  object:{msg:"按下「開啟相機」對準物品拍照，<br>或從相簿選一張照片。",load:"辨識模型載入中…（第一次約需 10～20 秒）",contrib:"🎙️ 提供客語資料"},
  text:{msg:"按下「開啟相機」對準客語文字拍照，<br>或從相簿選一張照片。",load:"文字辨識程式載入中…（第一次約需 10～20 秒）",contrib:"🚩 回報錯誤"}
};
function setMode(m,keepRes){
  APP.mode=m;lsSet("cam_mode",m);
  document.querySelectorAll(".modes [data-mode]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.mode===m));
  const u=MODE_UI[m];
  if(!stream){$("#camMsg").innerHTML=u.msg;$("#camMsg").classList.remove("hide")}
  $("#aim").classList.toggle("hide",m!=="text"||!stream);
  $("#typeCard").classList.toggle("hide",m!=="text");
  $("#snapBtn").parentElement.classList.toggle("hide",m!=="text");
  $("#btnContrib").textContent=u.contrib;
  $("#modelMsg").textContent=u.load;
  const p=new URL(location.href);p.searchParams.set("mode",m);history.replaceState(null,"",p.pathname+p.search);
  if(!keepRes&&!$("#resBox").classList.contains("hide"))backToCam();
  else if(stream)openCam();   // 換解析度
  M().load().catch(()=>{});
}
document.querySelector(".modes").onclick=e=>{const b=e.target.closest("[data-mode]");if(b&&b.dataset.mode!==APP.mode){unlockAudio();setMode(b.dataset.mode)}};

/* ================= 腔調 ================= */
function setDialect(d){
  DIALECT=d;lsSet("cam_dialect",d);$("#dialect").value=d;
  if(PROFILE&&PROFILE.dialect!==d){PROFILE.dialect=d;saveProfile({dialect:d})}
}
$("#dialect").innerHTML=[1,2,3,4,5,6].map(d=>`<option value="${d}">${DN(d)}</option>`).join("");
$("#dialect").value=DIALECT;
$("#dialect").onchange=()=>{setDialect(+$("#dialect").value);if(M().has()&&!$("#resBox").classList.contains("hide"))M().render(true);if(curTab==="vFav")renderFavs()};

/* ================= 帳號 ================= */
async function afterLogin(){
  await loadProfile();await loadFavs();
  IS_ADMIN=await checkAdmin();
  refreshAuthUI();toast("歡迎，"+(PROFILE&&PROFILE.display_name||AUTH.email));
  if(curTab!=="vCam")showTab(curTab);
}
HOOKS.onSignOut=()=>{
  PROFILE=null;FAVS=[];GROUPS=[];IS_ADMIN=false;
  refreshAuthUI();if(curTab!=="vCam")showTab(curTab);
};
function refreshAuthUI(){
  $("#btnAuth").textContent=AUTH?"👤 "+((PROFILE&&PROFILE.display_name)||AUTH.email.split("@")[0]):"登入";
  $("#btnAdmin").classList.toggle("hide",!IS_ADMIN);
  updateDue();
}
$("#btnAuth").onclick=()=>AUTH?openAccount():openAuth("login",afterLogin);
async function loadProfile(){
  if(!AUTH)return;
  try{
    const rows=await api("cam_profiles?select=*&user_id=eq."+AUTH.uid);
    PROFILE=rows[0]||null;
    if(!PROFILE){
      const name=lsGet("cam_pending_name","")||AUTH.email.split("@")[0];
      const r=await api("cam_profiles",{method:"POST",headers:{Prefer:"return=representation"},body:{display_name:name.slice(0,40),dialect:DIALECT}});
      PROFILE=r[0];try{localStorage.removeItem("cam_pending_name")}catch(e){}
    }
    if(PROFILE.dialect&&PROFILE.dialect!==DIALECT){DIALECT=PROFILE.dialect;lsSet("cam_dialect",DIALECT);$("#dialect").value=DIALECT}
  }catch(e){console.warn("profile",e);toast(zhErr(e))}
}
async function saveProfile(patch){
  if(!AUTH)return;
  try{await api("cam_profiles?user_id=eq."+AUTH.uid,{method:"PATCH",body:Object.assign({updated_at:new Date().toISOString()},patch)})}catch(e){toast(zhErr(e))}
}
function openAccount(){
  const g=PROFILE?PROFILE.review_gap:0;
  openModal(`<h2>我的帳號 <button class="btn sm ghost" data-close>✕</button></h2>
    <p class="muted">${esc(AUTH.email)}${IS_ADMIN?"・網站管理者":""}</p>
    <label class="f" for="acName">顯示名稱</label><input class="f" id="acName" maxlength="40" value="${esc(PROFILE?PROFILE.display_name:"")}">
    <label class="f" for="acDial">預設腔調</label><select class="f" id="acDial">${[1,2,3,4,5,6].map(d=>`<option value="${d}" ${d===DIALECT?"selected":""}>${DN(d)}</option>`).join("")}</select>
    <label class="f" for="acGap">複習間隔（每張照片最多複習 ${MAX_REVIEW} 次）</label>
    <select class="f" id="acGap">
      <option value="0" ${g===0?"selected":""}>漸進：隔 1 天、2 天，之後每 3 天</option>
      <option value="1" ${g===1?"selected":""}>每 1 天</option>
      <option value="2" ${g===2?"selected":""}>每 2 天</option>
      <option value="3" ${g===3?"selected":""}>每 3 天</option>
    </select>
    <div class="err" id="acMsg"></div>
    <div class="row"><button class="btn pri grow" id="acSave">儲存</button><button class="btn" id="acMine">📮 我的投稿</button>${IS_ADMIN?`<a class="btn" href="admin.html">🛠️ 管理</a>`:""}<button class="btn danger" id="acOut">登出</button></div>`);
  $("#acSave").onclick=async()=>{
    const patch={display_name:$("#acName").value.trim().slice(0,40),dialect:+$("#acDial").value,review_gap:+$("#acGap").value};
    await saveProfile(patch);PROFILE=Object.assign(PROFILE||{},patch);setDialect(patch.dialect);refreshAuthUI();closeModal();toast("已儲存");
  };
  $("#acMine").onclick=openMyContribs;
  $("#acOut").onclick=()=>{closeModal();signOut()};
}

/* ================= 複習排程 ================= */
/* 第 n 次複習完成後隔幾天再複習：漸進 1→2→3→3→3，或固定 1～3 天 */
function gapDays(doneCount){
  const g=PROFILE?PROFILE.review_gap:0;
  if(g>=1&&g<=3)return g;
  return [1,2,3,3,3][Math.min(doneCount,4)];
}
const isDue=f=>f.review_count<MAX_REVIEW&&f.next_review_at&&Date.parse(f.next_review_at)<=Date.now();
function updateDue(){
  const n=FAVS.filter(f=>f.user_id===(AUTH&&AUTH.uid)&&isDue(f)).length;
  const b=$("#dueBadge");b.textContent=n;b.classList.toggle("hide",!n);
  return n;
}

/* ================= 我的最愛 ================= */
async function loadFavs(){
  if(!AUTH){FAVS=[];return}
  try{FAVS=await api("cam_favorites?select=*&user_id=eq."+AUTH.uid+"&order=created_at.desc&limit=2000")}catch(e){console.warn(e);toast(zhErr(e))}
  updateDue();
}
$("#btnFav").onclick=async()=>{
  const fr=M().favRow();if(!fr)return;
  if(!AUTH){toast("登入後才能保存到我的最愛");openAuth("login",afterLogin);return}
  const d=M().contribDefaults();
  const btn=$("#btnFav");btn.disabled=true;btn.textContent="保存中…";
  try{
    const id=uuid(),path=AUTH.uid+"/fav/"+id+".jpg";
    await uploadFile(path,d.blob);
    const row=Object.assign({id,image_path:path,dialect:DIALECT,review_count:0,next_review_at:addDays(gapDays(0))},fr);
    const r=await api("cam_favorites",{method:"POST",headers:{Prefer:"return=representation"},body:row});
    FAVS.unshift(r[0]);SIGNED[path]={url:d.img,exp:Date.now()+3500*1000};
    updateDue();toast("已加入我的最愛，明天開始複習");
    btn.textContent="✅ 已加入";btn.dataset.saved="1";
  }catch(e){toast(zhErr(e));btn.textContent="⭐ 加入我的最愛";btn.disabled=false}
};
$("#btnAgain").onclick=backToCam;
function dotsHTML(n){return `<span class="dots">${Array.from({length:MAX_REVIEW},(_,k)=>`<i class="${k<n?"on":""}"></i>`).join("")}</span>`}
function statusText(f){
  if(f.review_count>=MAX_REVIEW)return "🎉 已完成 5 次複習";
  if(isDue(f))return `<span class="due">今天要複習</span>`;
  return "下次複習 "+fmtD(f.next_review_at);
}
const kindTag=k=>`<span class="kind ${k}">${k==="object"?"📦":"🔤"}</span>`;
const favTitle=f=>MODES[f.kind]?MODES[f.kind].favTitle(f):f.word;
async function renderFavs(){
  const box=$("#favList");
  if(!AUTH){box.innerHTML=`<div class="empty">登入後就能把拍到的物品和客語文字存起來，<br>並依排程每 1～3 天複習一次。<br><br><button class="btn pri" id="favLogin">登入／註冊</button></div>`;$("#favLogin").onclick=()=>openAuth("login",afterLogin);$("#dueBanner").innerHTML="";return}
  const flt=$("#favFilter").value,kd=$("#favKind").value;
  const list=FAVS.filter(f=>(kd==="all"||f.kind===kd)&&(flt==="all"||(flt==="due"&&isDue(f))||(flt==="doing"&&f.review_count<MAX_REVIEW)||(flt==="done"&&f.review_count>=MAX_REVIEW)));
  const n=updateDue();
  $("#dueBanner").innerHTML=n?`<div class="card row"><span class="grow">🔔 今天有 <b>${n}</b> 張照片要複習</span><button class="btn pri sm" id="goRev">開始複習</button></div>`:"";
  if(n)$("#goRev").onclick=()=>showTab("vRev");
  if(!list.length){box.innerHTML=`<div class="empty">${FAVS.length?"這個分類沒有照片。":"還沒有收藏。到「拍照」拍下身邊的物品或客語文字，按「⭐ 加入我的最愛」。"}</div>`;return}
  box.innerHTML=`<div class="grid">${list.map(f=>favCard(f)).join("")}</div>`;
  box.onclick=e=>{const b=e.target.closest("[data-fav]");if(b)openFav(FAVS.find(f=>f.id===b.dataset.fav))};
  await signFiles(list.map(f=>f.image_path));
  box.querySelectorAll("[data-img]").forEach(el=>{const u=fileUrl(el.dataset.img);if(u)el.style.backgroundImage=`url("${u}")`});
}
function favCard(f,who){
  const sub=MODES[f.kind]?MODES[f.kind].favSub(f):"";
  return `<button class="fav" data-fav="${f.id}"><div class="th" data-img="${esc(f.image_path)}"></div>
    <div class="tx"><div class="t1">${kindTag(f.kind)}${esc(favTitle(f))}</div>${sub?`<div class="t2">${esc(sub)}</div>`:""}<div class="t2">${who!=null?esc(who):statusText(f)}</div>${who!=null?"":dotsHTML(f.review_count)}</div></button>`;
}
$("#favFilter").onchange=renderFavs;$("#favKind").onchange=renderFavs;
async function openFav(f,opts){
  opts=opts||{};
  if(!f||!MODES[f.kind])return;
  await signFiles([f.image_path]);
  let d=f.dialect||DIALECT;
  const mine=AUTH&&f.user_id===AUTH.uid;
  const draw=async play=>{
    const vw=await MODES[f.kind].view(f,d,fileUrl(f.image_path));
    openModal(`<h2>${kindTag(f.kind)} ${esc(favTitle(f))} <button class="btn sm ghost" data-close>✕</button></h2>${vw.html}
      <p class="muted">收藏於 ${fmtT(f.created_at)}・已複習 ${f.review_count}/${MAX_REVIEW} 次 ${dotsHTML(f.review_count)}<br>${statusText(f)}</p>
      ${mine?`<div class="row"><label class="muted">分享到群組相簿</label><select class="btn sm grow" id="fvGrp"><option value="">不分享</option>${GROUPS.map(g=>`<option value="${g.id}" ${g.id===f.group_id?"selected":""}>${esc(g.name)}</option>`).join("")}</select></div>
      <div class="row" style="margin-top:10px">${isDue(f)?`<button class="btn pri" id="fvRev">✅ 完成今天的複習</button>`:""}<span class="grow"></span><button class="btn danger sm" id="fvDel">刪除</button></div>`:""}`);
    vw.bind($("#sheet"),(nd,p)=>{d=nd;draw(p)});
    if(mine){
      if(!GROUPS.length&&!draw._g){draw._g=1;loadGroups().then(()=>{if(!$("#modal").classList.contains("hide")&&GROUPS.length)draw(false)})}
      $("#fvGrp").onchange=async e=>{
        const gid=e.target.value||null;
        try{await api("cam_favorites?id=eq."+f.id,{method:"PATCH",body:{group_id:gid}});f.group_id=gid;toast(gid?"已分享到群組相簿":"已取消分享")}catch(err){toast(zhErr(err))}
      };
      const rv=$("#fvRev");if(rv)rv.onclick=async()=>{try{await markReviewed(f);closeModal();renderFavs()}catch(err){toast(zhErr(err))}};
      $("#fvDel").onclick=async()=>{
        if(!confirm("確定刪除「"+favTitle(f)+"」這張收藏？"))return;
        try{await api("cam_favorites?id=eq."+f.id,{method:"DELETE"});await removeFiles([f.image_path]);FAVS=FAVS.filter(x=>x.id!==f.id);closeModal();renderFavs();toast("已刪除")}catch(err){toast(zhErr(err))}
      };
    }
    if(play)vw.play($("#sheet"));
  };
  draw(!!opts.autoplay);
}
async function markReviewed(f){
  const n=Math.min(MAX_REVIEW,f.review_count+1);
  const patch={review_count:n,last_review_at:new Date().toISOString(),next_review_at:n>=MAX_REVIEW?null:addDays(gapDays(n))};
  await api("cam_favorites?id=eq."+f.id,{method:"PATCH",body:patch});
  Object.assign(f,patch);updateDue();
  APP.logActivity(f.kind,"review",f.id);
}

/* ================= 複習（兩種模式混合） ================= */
let REV=null;   // {list,idx,done,shown,d}
async function renderReview(){
  const body=$("#revBody");
  if(!AUTH){body.innerHTML=`<div class="empty">登入後，系統會依排程（每 1～3 天）提醒你複習收藏的照片，每張最多複習 ${MAX_REVIEW} 次。<br><br><button class="btn pri" id="rvLogin">登入／註冊</button></div>`;$("#rvLogin").onclick=()=>openAuth("login",afterLogin);return}
  if(REV&&REV.idx<REV.list.length)return drawRevCard();
  const due=FAVS.filter(isDue);
  const doing=FAVS.filter(f=>f.review_count<MAX_REVIEW&&!isDue(f)).sort((a,b)=>Date.parse(a.next_review_at)-Date.parse(b.next_review_at));
  const done=FAVS.filter(f=>f.review_count>=MAX_REVIEW).length;
  const gapTxt=(PROFILE&&PROFILE.review_gap)?`每 ${PROFILE.review_gap} 天`:"漸進（隔 1、2、3 天）";
  const nObj=due.filter(f=>f.kind==="object").length,nTxt=due.length-nObj;
  body.innerHTML=`<div class="card">
      <h2 style="font-size:18px;margin:0 0 6px">🔁 今日複習</h2>
      ${REV&&REV.done?`<p>👏 剛剛完成 ${REV.done} 張複習！</p>`:""}
      <p>${due.length?`今天有 <b>${due.length}</b> 張照片要複習（📦 物件 ${nObj} 張、🔤 文字 ${nTxt} 張）。`:"今天沒有要複習的照片 🎉"}</p>
      <div class="row">${due.length?`<button class="btn pri" id="rvStart">開始複習</button>`:""}<button class="btn" id="rvSet">⚙️ 複習間隔：${gapTxt}</button></div>
    </div>
    <div class="card"><div class="row"><span class="grow">收藏 ${FAVS.length} 張・複習中 ${due.length+doing.length} 張・已完成 ${done} 張</span></div>
      ${doing.length?`<p class="muted" style="margin:10px 0 4px">接下來的複習</p><div class="tbl"><table><tr><th>內容</th><th>已複習</th><th>下次</th></tr>${doing.slice(0,12).map(f=>`<tr><td>${kindTag(f.kind)}${esc(favTitle(f))}</td><td>${dotsHTML(f.review_count)}</td><td>${fmtD(f.next_review_at)}</td></tr>`).join("")}</table></div>`:""}
    </div>`;
  REV=null;
  const st=$("#rvStart");if(st)st.onclick=()=>{unlockAudio();REV={list:due.slice(),idx:0,done:0,shown:false,d:null};drawRevCard()};
  $("#rvSet").onclick=openAccount;
}
async function drawRevCard(){
  const f=REV.list[REV.idx];
  await signFiles([f.image_path]);
  const d=REV.d||f.dialect||DIALECT;
  const head=`<div class="row"><span class="grow muted" style="text-align:left">${kindTag(f.kind)}第 ${REV.idx+1} / ${REV.list.length} 張・這張第 ${f.review_count+1} 次複習</span><button class="btn sm ghost" id="rvQuit">結束</button></div>
     <div class="prog"><i style="width:${REV.idx/REV.list.length*100}%"></i></div>`;
  // 文字收藏先看照片想想怎麼唸，再翻開答案
  if(f.kind==="text"&&!REV.shown){
    $("#revBody").innerHTML=`<div class="card revcard">${head}${photoHTML(fileUrl(f.image_path),f.box)}
      <p>🤔 框框裡的字，用${DN(d)}怎麼唸？</p>
      <button class="btn pri" id="rvShow">👀 看答案</button></div>`;
    $("#rvShow").onclick=()=>{unlockAudio();REV.shown=true;drawRevCard()};
  }else{
    const vw=await MODES[f.kind].view(f,d,fileUrl(f.image_path));
    $("#revBody").innerHTML=`<div class="card revcard">${head}<div class="res">${vw.html}</div>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="btn pri" id="rvOk">✅ 記住了，下一張</button></div></div>`;
    vw.bind($("#revBody"),nd=>{REV.d=nd;drawRevCard()});
    $("#rvOk").onclick=async()=>{
      $("#rvOk").disabled=true;
      try{await markReviewed(FAVS.find(x=>x.id===f.id)||f);REV.done++;REV.idx++;REV.shown=false;REV.d=null;stopAll();renderReview()}
      catch(e){toast(zhErr(e));$("#rvOk").disabled=false}
    };
    vw.play($("#revBody"));
  }
  $("#rvQuit").onclick=()=>{stopAll();REV.idx=REV.list.length;renderReview()};
}

/* ================= 投稿：提供客語資料／回報錯誤 ================= */
const ISSUES={ocr:"文字辨識錯字",pron:"拼音（讀音）錯誤",audio:"發音錄音錯誤",gloss:"解釋錯誤",other:"其他"};
/* 錄音機：MediaRecorder，最長 20 秒 */
function recorderUI(root){
  const st={blob:null,rec:null,stream:null,timer:null,url:null};
  const box=root.querySelector("#recBox");
  const draw=state=>{
    if(state==="rec")box.innerHTML=`<span class="dot"></span><span id="recT">錄音中 0 秒</span><button type="button" class="btn sm pri" id="recStop">⏹ 停止</button>`;
    else if(st.blob)box.innerHTML=`<audio controls src="${st.url}"></audio><button type="button" class="btn sm" id="recAgain">🔁 重錄</button><button type="button" class="btn sm ghost" id="recDel">刪除</button>`;
    else box.innerHTML=`<button type="button" class="btn sm" id="recGo">🎙️ 開始錄音</button><span class="muted">請用${DN(DIALECT)}清楚唸一次（最長 20 秒）</span>`;
    const go=box.querySelector("#recGo,#recAgain");if(go)go.onclick=start;
    const sp=box.querySelector("#recStop");if(sp)sp.onclick=stop;
    const dl=box.querySelector("#recDel");if(dl)dl.onclick=()=>{st.blob=null;draw()};
  };
  async function start(){
    if(!window.MediaRecorder||!navigator.mediaDevices){toast("這個瀏覽器不支援錄音，請改用 Chrome 或 Safari");return}
    try{st.stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch(e){toast("無法使用麥克風，請允許瀏覽器使用麥克風");return}
    const types=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg;codecs=opus","audio/ogg"];
    const type=types.find(t=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(t));
    const chunks=[];
    st.rec=new MediaRecorder(st.stream,type?{mimeType:type}:undefined);
    st.rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
    st.rec.onstop=()=>{
      st.stream.getTracks().forEach(t=>t.stop());clearInterval(st.timer);
      st.blob=new Blob(chunks,{type:(st.rec.mimeType||type||"audio/webm").split(";")[0]});
      if(st.url)URL.revokeObjectURL(st.url);st.url=URL.createObjectURL(st.blob);draw();
    };
    st.rec.start();const t0=Date.now();draw("rec");
    st.timer=setInterval(()=>{const s=Math.round((Date.now()-t0)/1000);const el=box.querySelector("#recT");if(el)el.textContent="錄音中 "+s+" 秒";if(s>=20)stop()},250);
  }
  function stop(){if(st.rec&&st.rec.state==="recording")st.rec.stop()}
  draw();
  closeModal.onClose=()=>{stop();if(st.stream)st.stream.getTracks().forEach(t=>t.stop())};
  return st;
}
const audioExt=t=>/mp4|aac/.test(t)?"m4a":/ogg/.test(t)?"ogg":/mpeg/.test(t)?"mp3":/wav/.test(t)?"wav":"webm";
$("#btnContrib").onclick=()=>openContrib(APP.mode);
function openContrib(kind){
  if(!AUTH){toast("登入後才能提供資料");openAuth("login",afterLogin);return}
  const d=MODES[kind].contribDefaults();if(!d)return;
  stopAll();
  const obj=kind==="object";
  openModal(`<h2>${obj?"🎙️ 提供客語資料":"🚩 回報錯誤"} <button class="btn sm ghost" data-close>✕</button></h2>
    <p class="muted" style="margin-top:0">${obj?"告訴我們照片裡的物品用客語怎麼說，審核後會加入資料庫，作為未來影像辨識的資料。":"發現辨識的字、拼音或發音有錯？請告訴我們正確的寫法與唸法，審核後會用來更正資料。"}</p>
    <img class="thumb" src="${d.img}" alt="">
    <form id="ctForm">
      ${obj?`<label class="f" for="ctZh">這是什麼？（國語名稱）</label><input class="f" id="ctZh" maxlength="60" value="${esc(d.zh)}" placeholder="例如：電風扇">`
        :`<label class="f" for="ctIssue">錯誤類型</label><select class="f" id="ctIssue">${Object.entries(ISSUES).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select>
          <p class="muted">系統原本顯示：<b>${esc(d.orig_text||"（沒有辨識到文字）")}</b>${d.orig_pron?`　${esc(markPron(d.orig_pron,DIALECT))}`:""}</p>`}
      <label class="f" for="ctDial">腔調</label><select class="f" id="ctDial">${[1,2,3,4,5,6].map(x=>`<option value="${x}" ${x===DIALECT?"selected":""}>${DN(x)}</option>`).join("")}</select>
      <label class="f" for="ctHan">${obj?"客語漢字":"正確的客語漢字"}（必填）</label><input class="f" id="ctHan" maxlength="60" required value="${esc(d.hanzi)}" placeholder="例如：電風">
      <label class="f" for="ctPin">${obj?"客語拼音":"正確的客語拼音"}</label><input class="f" id="ctPin" maxlength="200" value="${esc(d.pinyin)}" placeholder="可用數字調，例如：tien55 fung24" autocapitalize="off" autocomplete="off" spellcheck="false">
      <label class="f">錄音（拼音和錄音至少提供一項）</label><div class="rec" id="recBox"></div>
      <label class="f" for="ctNote">補充說明（選填）</label><textarea class="f" id="ctNote" maxlength="500" placeholder="${obj?"例如：我們庄頭也講……":"例如：第二個字應該是……"}"></textarea>
      <div class="err" id="ctMsg"></div>
      <div class="row"><button class="btn pri grow" id="ctGo">送出</button></div>
    </form>`);
  const rec=recorderUI($("#sheet"));
  $("#ctForm").onsubmit=async e=>{
    e.preventDefault();
    const msg=$("#ctMsg"),go=$("#ctGo");
    const hanzi=$("#ctHan").value.trim(),pinyin=$("#ctPin").value.trim().replace(/\s+/g," ");
    if(!hanzi){msg.textContent="請輸入客語漢字";return}
    if(!pinyin&&!rec.blob){msg.textContent="請填寫拼音或錄一段發音";return}
    if(rec.rec&&rec.rec.state==="recording"){msg.textContent="請先停止錄音";return}
    go.disabled=true;msg.textContent="上傳中…";
    try{
      const id=uuid(),base=AUTH.uid+"/contrib/"+id;
      await uploadFile(base+".jpg",d.blob);
      let audio=null;
      if(rec.blob){audio=base+"."+audioExt(rec.blob.type);await uploadFile(audio,rec.blob)}
      const row={id,kind,image_path:base+".jpg",audio_path:audio,box:d.box||null,dialect:+$("#ctDial").value,hanzi:hanzi.slice(0,60),pinyin:pinyin||null,note:$("#ctNote").value.trim().slice(0,500)||null};
      if(obj)Object.assign(row,{zh:$("#ctZh").value.trim().slice(0,60)||null,concept:d.concept,label:d.label});
      else Object.assign(row,{issue:$("#ctIssue").value,orig_text:(d.orig_text||"").slice(0,200)||null,orig_pron:d.orig_pron||null});
      await api("cam_contributions",{method:"POST",body:row});
      closeModal();toast(obj?"感謝提供！審核後會加入資料庫":"感謝回報！我們會盡快確認");
    }catch(err){msg.textContent=zhErr(err);go.disabled=false}
  };
}
async function openMyContribs(){
  openModal(`<h2>📮 我的投稿 <button class="btn sm ghost" data-close>✕</button></h2><div id="mcList"><div class="busy"><div class="spin"></div>載入中…</div></div>`);
  let rows=[];
  try{rows=await api("cam_contributions?select=*&user_id=eq."+AUTH.uid+"&order=created_at.desc&limit=200")}catch(e){$("#mcList").innerHTML=`<p class="err">${esc(zhErr(e))}</p>`;return}
  const ST={pending:"審核中",accepted:"已採用",rejected:"未採用"};
  const draw=()=>{
    if(!rows.length){$("#mcList").innerHTML=`<p class="empty">還沒有投稿。拍照後按「🎙️ 提供客語資料」或「🚩 回報錯誤」就能投稿。</p>`;return}
    $("#mcList").innerHTML=rows.map(r=>`<div class="card"><div class="row"><span class="grow">${kindTag(r.kind)}<b>${esc(r.hanzi)}</b> ${r.zh?`<span class="muted">（${esc(r.zh)}）</span>`:""}</span><span class="st ${r.status}">${ST[r.status]}</span></div>
      <div class="muted">${DN(r.dialect)}・${esc(r.pinyin||"")}${r.kind==="text"&&r.issue?"・"+ISSUES[r.issue]:""}・${fmtT(r.created_at)}</div>
      ${r.admin_note?`<div class="note">管理者回覆：${esc(r.admin_note)}</div>`:""}
      <div class="row" style="margin-top:6px">${r.audio_path?`<button class="btn sm" data-play="${esc(r.audio_path)}">▶️ 我的錄音</button>`:""}<span class="grow"></span>${r.status==="pending"?`<button class="btn sm danger" data-del="${r.id}">撤回</button>`:""}</div></div>`).join("");
  };
  draw();
  $("#mcList").onclick=async e=>{
    const p=e.target.closest("[data-play]"),dl=e.target.closest("[data-del]");
    if(p){await signFiles([p.dataset.play]);stopAll();const tok=playToken;markBtn(p);await playOne(fileUrl(p.dataset.play),tok);if(tok===playToken)markBtn(null)}
    if(dl){
      const r=rows.find(x=>x.id===dl.dataset.del);if(!r||!confirm("確定撤回這筆投稿？"))return;
      try{await api("cam_contributions?id=eq."+r.id,{method:"DELETE"});await removeFiles([r.image_path,r.audio_path]);rows=rows.filter(x=>x!==r);draw();toast("已撤回")}catch(err){toast(zhErr(err))}
    }
  };
}

/* ================= 群組 ================= */
async function loadGroups(){
  if(!AUTH){GROUPS=[];return}
  try{
    const rows=await api("cam_group_members?select=role,cam_groups(id,name,join_code,owner_id,created_at)&user_id=eq."+AUTH.uid);
    GROUPS=rows.filter(r=>r.cam_groups).map(r=>Object.assign({role:r.role},r.cam_groups)).sort((a,b)=>a.created_at<b.created_at?-1:1);
  }catch(e){console.warn(e)}
}
const ROLE={owner:"擁有者",admin:"管理員",member:"成員"};
async function renderGroups(){
  const body=$("#grpBody");
  if(!AUTH){body.innerHTML=`<div class="empty">登入後可以建立群組（例如班級、家庭），<br>邀請成員加入、分享收藏照片，管理者還能看到每位成員的複習進度。<br><br><button class="btn pri" id="gLogin">登入／註冊</button></div>`;$("#gLogin").onclick=()=>openAuth("login",afterLogin);return}
  body.innerHTML=`<div class="busy"><div class="spin"></div>載入中…</div>`;
  await loadGroups();
  body.innerHTML=`<div class="card">
      <h2 style="font-size:18px;margin:0 0 8px">👥 我的群組</h2>
      ${GROUPS.length?GROUPS.map(g=>`<button class="btn" style="width:100%;text-align:left;margin:4px 0" data-g="${g.id}"><b>${esc(g.name)}</b> <span class="muted">・${ROLE[g.role]}</span></button>`).join(""):`<p class="muted">還沒有加入任何群組。</p>`}
    </div>
    <div class="card">
      <label class="f" for="gName">建立新群組</label>
      <div class="row"><input class="f grow" id="gName" maxlength="40" placeholder="例如：三年甲班、陳家客語角" style="width:auto"><button class="btn pri" id="gCreate">建立</button></div>
      <label class="f" for="gCode">用邀請代碼加入群組</label>
      <div class="row"><input class="f grow" id="gCode" maxlength="12" placeholder="6 碼代碼" style="width:auto;text-transform:uppercase"><button class="btn" id="gJoin">加入</button></div>
      <div class="err" id="gMsg"></div>
    </div>`;
  body.querySelectorAll("[data-g]").forEach(b=>b.onclick=()=>renderGroup(b.dataset.g));
  $("#gCreate").onclick=async()=>{
    const name=$("#gName").value.trim();if(!name){$("#gMsg").textContent="請輸入群組名稱";return}
    try{const g=await rpc("cam_create_group",{p_name:name});toast("已建立群組「"+name+"」");renderGroup(g.id)}catch(e){$("#gMsg").textContent=zhErr(e)}
  };
  $("#gJoin").onclick=async()=>{
    const code=$("#gCode").value.trim();if(!code){$("#gMsg").textContent="請輸入邀請代碼";return}
    try{const g=await rpc("cam_join_group",{p_code:code});toast("已加入「"+g.name+"」");renderGroup(g.id)}catch(e){$("#gMsg").textContent=zhErr(e)}
  };
}
async function renderGroup(gid){
  const body=$("#grpBody");
  body.innerHTML=`<div class="busy"><div class="spin"></div>載入中…</div>`;
  await loadGroups();
  const g=GROUPS.find(x=>x.id===gid);
  if(!g){renderGroups();return}
  const mgr=g.role==="owner"||g.role==="admin";
  let members=[],album=[];
  try{
    if(mgr)members=await rpc("cam_group_progress",{p_group:gid});
    else{
      const ms=await api("cam_group_members?select=user_id,role&group_id=eq."+gid);
      const ps=ms.length?await api("cam_profiles?select=user_id,display_name&user_id=in.("+ms.map(m=>m.user_id).join(",")+")"):[];
      members=ms.map(m=>({user_id:m.user_id,role:m.role,display_name:(ps.find(p=>p.user_id===m.user_id)||{}).display_name||"（未設定名稱）"}));
    }
    album=await api("cam_favorites?select=*&group_id=eq."+gid+"&order=created_at.desc&limit=300");
  }catch(e){toast(zhErr(e))}
  const nameOf=uid=>{const m=members.find(x=>x.user_id===uid);return m?m.display_name:""};
  body.innerHTML=`<div class="row" style="margin-top:12px"><button class="btn sm" id="gBack">← 群組列表</button></div>
    <div class="card">
      <h2 style="font-size:18px;margin:0">${esc(g.name)}</h2>
      <p class="muted" style="margin:4px 0">我的角色：${ROLE[g.role]}・成員 ${members.length} 人</p>
      ${mgr?`<div class="row"><span>邀請代碼：<b style="font-size:20px;letter-spacing:2px">${esc(g.join_code)}</b></span><button class="btn sm" id="gCopy">複製</button><button class="btn sm" id="gNew">換新代碼</button></div><p class="muted">把代碼給成員，他們在「群組」頁輸入即可加入。</p>`:""}
    </div>
    <div class="card"><h3 style="font-size:16px;margin:0 0 6px">成員${mgr?"與學習進度":""}</h3><div class="tbl"><table>
      <tr><th>名稱</th><th>角色</th>${mgr?"<th>收藏<br><span class='muted'>📦/🔤</span></th><th>完成</th><th>待複習</th><th>投稿</th><th></th>":""}</tr>
      ${members.map(m=>`<tr><td>${esc(m.display_name)}${mgr&&m.email?`<br><span class="muted">${esc(m.email)}</span>`:""}</td><td>${ROLE[m.role]}</td>
        ${mgr?`<td>${m.fav_object}/${m.fav_text}</td><td>${m.finished}</td><td>${m.due?`<span class="due">${m.due}</span>`:0}</td><td>${m.contrib_object+m.contrib_text}</td><td style="white-space:nowrap">${memberActions(g,m)}</td>`:""}</tr>`).join("")}
    </table></div></div>
    <div class="card"><h3 style="font-size:16px;margin:0 0 6px">📷 群組相簿（${album.length}）</h3>
      ${album.length?`<div class="grid" id="gAlbum">${album.map(f=>favCard(f,nameOf(f.user_id))).join("")}</div>`:`<p class="muted">在「我的最愛」打開照片，選擇「分享到群組相簿」，大家就能一起看、一起聽。</p>`}
    </div>
    <div class="row" style="margin-bottom:12px">${g.role==="owner"?`<button class="btn danger sm" id="gDel">刪除群組</button>`:`<button class="btn danger sm" id="gLeave">退出群組</button>`}</div>`;
  $("#gBack").onclick=renderGroups;
  if(mgr){
    $("#gCopy").onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(g.join_code).then(()=>toast("已複製代碼"),()=>toast("代碼："+g.join_code))};
    $("#gNew").onclick=async()=>{if(!confirm("換新代碼後，舊代碼就不能再用來加入。確定？"))return;try{await rpc("cam_new_code",{p_group:gid});renderGroup(gid)}catch(e){toast(zhErr(e))}};
  }
  body.querySelectorAll("[data-act]").forEach(b=>b.onclick=async()=>{
    const [act,uid]=b.dataset.act.split(":");
    try{
      if(act==="kick"){if(!confirm("確定把「"+nameOf(uid)+"」移出群組？"))return;await api("cam_group_members?group_id=eq."+gid+"&user_id=eq."+uid,{method:"DELETE"})}
      else await rpc("cam_set_role",{p_group:gid,p_user:uid,p_role:act});
      renderGroup(gid);
    }catch(e){toast(zhErr(e))}
  });
  const alb=$("#gAlbum");
  if(alb){
    alb.onclick=e=>{const b=e.target.closest("[data-fav]");if(b)openFav(album.find(f=>f.id===b.dataset.fav),{autoplay:true})};
    await signFiles(album.map(f=>f.image_path));
    alb.querySelectorAll("[data-img]").forEach(el=>{const u=fileUrl(el.dataset.img);if(u)el.style.backgroundImage=`url("${u}")`});
  }
  const del=$("#gDel");if(del)del.onclick=async()=>{if(!confirm("確定刪除群組「"+g.name+"」？成員的收藏不會被刪除，但會取消分享。"))return;try{await api("cam_groups?id=eq."+gid,{method:"DELETE"});toast("群組已刪除");renderGroups()}catch(e){toast(zhErr(e))}};
  const lv=$("#gLeave");if(lv)lv.onclick=async()=>{if(!confirm("確定退出群組「"+g.name+"」？"))return;try{await api("cam_group_members?group_id=eq."+gid+"&user_id=eq."+AUTH.uid,{method:"DELETE"});toast("已退出群組");renderGroups()}catch(e){toast(zhErr(e))}};
}
function memberActions(g,m){
  if(m.user_id===AUTH.uid||m.role==="owner")return "";
  const out=[];
  if(g.role==="owner")out.push(m.role==="admin"?`<button class="btn sm" data-act="member:${m.user_id}">取消管理員</button>`:`<button class="btn sm" data-act="admin:${m.user_id}">設為管理員</button>`);
  if(g.role==="owner"||(g.role==="admin"&&m.role==="member"))out.push(`<button class="btn sm danger" data-act="kick:${m.user_id}">移出</button>`);
  return out.join(" ");
}

/* ================= 分頁 ================= */
function showTab(t){
  curTab=t;stopAll();
  ["vCam","vFav","vRev","vGrp"].forEach(x=>$("#"+x).classList.toggle("hide",x!==t));
  document.querySelectorAll("nav.tabs button").forEach(b=>{if(b.dataset.tab===t)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  if(t!=="vCam")stopCam();
  else if($("#resBox").classList.contains("hide")&&camWanted)openCam();
  if(t==="vFav")renderFavs();
  if(t==="vRev")renderReview();
  if(t==="vGrp")renderGroups();
  window.scrollTo(0,0);
}
document.querySelector("nav.tabs").onclick=e=>{const b=e.target.closest("[data-tab]");if(b)showTab(b.dataset.tab)};

/* ================= 拍照按鈕 ================= */
$("#btnShoot").onclick=async()=>{
  unlockAudio();
  if(!stream){camWanted=true;await openCam();return}
  const c=await fromVideo();if(c)handleCanvas(c);
};
$("#btnFlip").onclick=()=>{facing=facing==="environment"?"user":"environment";camWanted=true;openCam()};
$("#file").onchange=$("#snap").onchange=async e=>{
  unlockAudio();
  const f=e.target.files[0];e.target.value="";if(!f)return;
  try{handleCanvas(await fromFile(f))}catch(err){toast(err.message)}
};
$("#camMsg").onclick=()=>$("#btnShoot").click();
async function typed(){unlockAudio();stopAll();if(await TXT.handleText($("#typeIn").value)){showResult();stopCam();TXT.render(true)}}
$("#btnType").onclick=typed;
$("#typeIn").onkeydown=e=>{if(e.key==="Enter")typed()};

/* ================= 啟動 ================= */
(async()=>{
  await handleAuthHash();
  setMode(APP.mode,true);
  refreshAuthUI();
  if(AUTH&&await ensureToken()){await loadProfile();await loadFavs();IS_ADMIN=await checkAdmin();refreshAuthUI();loadGroups();
    const n=updateDue();if(n)toast("🔔 今天有 "+n+" 張照片要複習");}
})();
