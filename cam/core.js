/* 拍照學客語（合併版）共用核心：設定、工具、Supabase、發音、對話框、會員登入。index.html 與 admin.html 共用 */

/* ================= 設定 ================= */
const SB_URL="https://ktsmglzfefzqhcuomkll.supabase.co";
const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0c21nbHpmZWZ6cWhjdW9ta2xsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5ODk1ODIsImV4cCI6MjEwNjU2NTU4Mn0.lUqXBvu08UcNbUG4oprHgB-vDdq1NVybJeIF-fjJZR0";
const BUCKET="cam";
const AUDIO_BASE="https://hakkadict.moe.edu.tw/static/audio/";
const MOEDICT="https://www.moedict.tw/:";
const MAX_REVIEW=5;
/* 各腔調的聲調符號（依教育部《臺灣客語辭典》）：調值 → [調名, 符號]；與主網站相同 */
const DIAL={
  1:{n:"四縣腔",t:{"24":["陰平","ˊ"],"11":["陽平","ˇ"],"31":["上聲","ˋ"],"55":["去聲",""],"2":["陰入","ˋ"],"5":["陽入",""]}},
  2:{n:"海陸腔",t:{"53":["陰平","ˋ"],"55":["陽平",""],"24":["上聲","ˊ"],"11":["陰去","ˇ"],"33":["陽去","+"],"5":["陰入",""],"2":["陽入","ˋ"]}},
  3:{n:"大埔腔",t:{"33":["陰平","+"],"31":["上聲","^"],"53":["去聲","ˋ"],"113":["陽平","ˇ"],"21":["陰入","^"],"54":["陽入","ˋ"],"35":["變調","ˊ"]}},
  4:{n:"饒平腔",t:{"11":["陰平","ˇ"],"53":["上聲","ˋ"],"55":["陽平",""],"24":["去聲","ˊ"],"2":["陰入","ˋ"],"5":["陽入",""]}},
  5:{n:"詔安腔",t:{"11":["陰平","ˇ"],"31":["上聲","^"],"53":["陽平","ˋ"],"55":["去聲",""],"24":["陰入","ˊ"],"43":["陽入","ˋ"]}},
  6:{n:"南四縣腔",t:{"24":["陰平","ˊ"],"11":["陽平","ˇ"],"31":["上聲","ˋ"],"55":["去聲",""],"2":["陰入","ˋ"],"5":["陽入",""]}}
};
const HAN=/[㐀-鿿豈-﫿\u{20000}-\u{3134f}]/u;
const KIND_NAME={object:"認物件",text:"認文字"};

/* ================= 工具 ================= */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function lsGet(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2600)}
function uuid(){return crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c=="x"?r:(r&3|8)).toString(16)})}
const p2=n=>String(n).padStart(2,"0");
const fmtD=t=>{if(!t)return "—";const d=new Date(t);return (d.getMonth()+1)+"/"+d.getDate()};
const fmtT=t=>{if(!t)return "—";const d=new Date(t);return d.getFullYear()+"/"+p2(d.getMonth()+1)+"/"+p2(d.getDate())};
const fmtDT=t=>{if(!t)return "—";const d=new Date(t);return fmtT(t)+" "+p2(d.getHours())+":"+p2(d.getMinutes())};
function startOfDay(t){const d=new Date(t);d.setHours(0,0,0,0);return d}
function addDays(n){const d=startOfDay(Date.now());d.setDate(d.getDate()+n);return d.toISOString()}
const auUrl=n=>AUDIO_BASE+n+(/\.(mp3|wav)$/.test(n)?"":".mp3");
const DN=d=>DIAL[d].n;
const pct=v=>(v*100).toFixed(2)+"%";

/* 數字調 → 調號：hi55 ca24 → hi ca24ˊ */
function markPron(p,d){
  const t=DIAL[d].t;
  return String(p||"").split(" ").map(s=>{const m=s.match(/^([a-z]+)(\d+)$/);return m?m[1]+(t[m[2]]?t[m[2]][1]:""):s}).join(" ");
}
/* 照片＋可選的黃框（位置 0~1） */
function photoHTML(src,box){
  const bx=box?`<div class="box" style="left:${pct(box[0])};top:${pct(box[1])};width:${pct(box[2])};height:${pct(box[3])}"></div>`:"";
  return `<div class="photo"><div class="pin"><img src="${esc(src)}" alt="">${bx}</div></div>`;
}

/* ================= Supabase REST ================= */
let AUTH=lsGet("cam_auth",null);   // {access,refresh,exp,uid,email}
const HOOKS={onSignOut:null};
function hdr(extra){return Object.assign({apikey:SB_KEY,Authorization:"Bearer "+(AUTH?AUTH.access:SB_KEY),"Content-Type":"application/json"},extra||{})}
function applySession(j){
  const u=j.user||{};
  AUTH={access:j.access_token,refresh:j.refresh_token,exp:Math.floor(Date.now()/1000)+(j.expires_in||3600),uid:u.id||(AUTH&&AUTH.uid),email:u.email||(AUTH&&AUTH.email)};
  lsSet("cam_auth",AUTH);
}
async function ensureToken(){
  if(!AUTH)return false;
  if(AUTH.exp-60>Date.now()/1000)return true;
  try{
    const r=await fetch(SB_URL+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:{apikey:SB_KEY,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:AUTH.refresh})});
    if(r.status===400||r.status===401){signOut(true);toast("登入已過期，請重新登入");return false}
    if(!r.ok)return false;
    applySession(await r.json());return true;
  }catch(e){return false}
}
async function api(path,opt){
  opt=opt||{};
  if(!(await ensureToken()))throw new Error("請先登入");
  const r=await fetch(SB_URL+"/rest/v1/"+path,{method:opt.method||"GET",headers:hdr(opt.headers),body:opt.body!==undefined?JSON.stringify(opt.body):undefined});
  const t=await r.text();let j=null;try{j=t?JSON.parse(t):null}catch(e){}
  if(!r.ok)throw new Error((j&&(j.message||j.hint||j.details))||("HTTP "+r.status));
  return j;
}
const rpc=(fn,args)=>api("rpc/"+fn,{method:"POST",body:args||{}});
/* 上傳照片或錄音到私有空間 */
async function uploadFile(path,blob){
  if(!(await ensureToken()))throw new Error("請先登入");
  const r=await fetch(SB_URL+"/storage/v1/object/"+BUCKET+"/"+path,{method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+AUTH.access,"Content-Type":(blob.type||"image/jpeg").split(";")[0],"x-upsert":"true"},body:blob});
  if(!r.ok)throw new Error("檔案上傳失敗（"+r.status+"）");
}
async function removeFiles(paths){
  paths=paths.filter(Boolean);
  if(!paths.length||!(await ensureToken()))return;
  await fetch(SB_URL+"/storage/v1/object/"+BUCKET,{method:"DELETE",headers:hdr(),body:JSON.stringify({prefixes:paths})}).catch(()=>{});
}
async function downloadFile(path){
  if(!(await ensureToken()))throw new Error("請先登入");
  const r=await fetch(SB_URL+"/storage/v1/object/authenticated/"+BUCKET+"/"+path,{headers:{apikey:SB_KEY,Authorization:"Bearer "+AUTH.access}});
  if(!r.ok)throw new Error("下載失敗（"+r.status+"）");
  return r.blob();
}
const SIGNED={};   // path → {url,exp}
async function signFiles(paths){
  const need=[...new Set(paths.filter(Boolean))].filter(p=>!SIGNED[p]||SIGNED[p].exp<Date.now()+60000);
  if(!need.length||!(await ensureToken()))return;
  for(let i=0;i<need.length;i+=100){
    const r=await fetch(SB_URL+"/storage/v1/object/sign/"+BUCKET,{method:"POST",headers:hdr(),body:JSON.stringify({expiresIn:3600,paths:need.slice(i,i+100)})});
    if(!r.ok)continue;
    (await r.json()).forEach(x=>{if(x.signedURL)SIGNED[x.path]={url:SB_URL+"/storage/v1"+x.signedURL,exp:Date.now()+3500*1000}});
  }
}
const fileUrl=p=>SIGNED[p]?SIGNED[p].url:"";
function zhErr(m){
  m=String(m&&m.message||m);
  const map={CODE_NOT_FOUND:"找不到這個群組代碼，請確認是否輸入正確。",NOT_OWNER:"只有群組擁有者可以做這件事。",NOT_MANAGER:"只有群組擁有者或管理員可以做這件事。",NOT_ADMIN:"只有網站管理者可以使用這個功能。",BAD_ROLE:"無法變更這位成員的角色。",NOT_LOGGED_IN:"請先登入。"};
  for(const k in map)if(m.includes(k))return map[k];
  if(/Invalid login credentials/i.test(m))return "信箱或密碼不正確。";
  if(/Email not confirmed/i.test(m))return "這個信箱還沒完成驗證，請先到信箱點確認連結。";
  if(/already registered|already been registered/i.test(m))return "這個信箱已經註冊過，請直接登入。";
  if(/at least 6|weak|Password should/i.test(m))return "密碼太短或太弱，請至少 6 個字元。";
  if(/rate limit|security purposes/i.test(m))return "操作太頻繁，請稍後再試。";
  if(/valid email|invalid format/i.test(m))return "電子信箱格式不正確。";
  if(/Failed to fetch|NetworkError|Load failed/i.test(m))return "連不上伺服器，請檢查網路。";
  if(/cam_\w+.*(does not exist|not find)|schema cache/i.test(m))return "資料庫尚未建立新版資料表，請管理者先執行 cam/supabase/001_cam.sql。";
  return "發生錯誤："+m;
}

/* ================= 發音 ================= */
const player=new Audio();player.preload="auto";
let playToken=0,sayBtn=null;
function markBtn(b){if(sayBtn)sayBtn.classList.remove("on");sayBtn=b||null;if(sayBtn)sayBtn.classList.add("on")}
function stopAll(){playToken++;try{speechSynthesis.cancel()}catch(e){}player.pause();markBtn(null)}
function playOne(url,tok){
  return new Promise(res=>{
    if(tok!==playToken)return res(false);
    const fin=ok=>{player.onended=player.onerror=null;res(ok)};
    player.onended=()=>fin(true);player.onerror=()=>fin(false);
    player.src=url;player.play().catch(()=>fin(false));
  });
}
/* iOS 需在使用者點擊時先「解鎖」語音與音訊 */
let unlocked=false;
function unlockAudio(){
  if(unlocked)return;unlocked=true;
  try{const u=new SpeechSynthesisUtterance(" ");u.volume=0;speechSynthesis.speak(u)}catch(e){}
  try{player.src="data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//sQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";player.play().then(()=>player.pause()).catch(()=>{})}catch(e){}
}

/* ================= 對話框 ================= */
function openModal(html){$("#sheet").innerHTML=html;$("#modal").classList.remove("hide");$("#sheet").querySelectorAll("[data-close]").forEach(b=>b.onclick=closeModal)}
function closeModal(){
  $("#modal").classList.add("hide");$("#sheet").innerHTML="";stopAll();
  if(closeModal.onClose){const f=closeModal.onClose;closeModal.onClose=null;f()}
}
$("#modal").onclick=e=>{if(e.target.id==="modal")closeModal()};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#modal").classList.contains("hide"))closeModal()});

/* ================= 會員登入 ================= */
let aMode="login";
function openAuth(m,afterLogin){
  aMode=m||"login";
  const login=aMode==="login",signup=aMode==="signup",reset=aMode==="reset";
  openModal(`<h2>${login?"會員登入":signup?"註冊新會員":"重設密碼"} <button class="btn sm ghost" data-close>✕</button></h2>
    <div class="row">${reset?"":`<button class="chip" data-m="login" aria-pressed="${login}">登入</button><button class="chip" data-m="signup" aria-pressed="${signup}">註冊</button>`}</div>
    <form id="authForm">
      <label class="f" for="aEmail">電子信箱</label><input class="f" id="aEmail" type="email" required autocomplete="email">
      ${reset?"":`<label class="f" for="aPw">密碼${signup?"（至少 6 個字元）":""}</label><input class="f" id="aPw" type="password" required minlength="6" autocomplete="${login?"current-password":"new-password"}">`}
      ${signup?`<label class="f" for="aName">顯示名稱（群組成員會看到）</label><input class="f" id="aName" maxlength="40" autocomplete="nickname">`:""}
      <div class="err" id="aMsg"></div>
      <div class="row"><button class="btn pri grow" id="aGo">${login?"登入":signup?"建立帳號":"寄出重設信"}</button></div>
      ${login?`<p class="muted"><a href="#" id="aForgot">忘記密碼？</a>　已在「客語字音字形練習」註冊的帳號可直接登入。</p>`:""}
    </form>`);
  $("#sheet").querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>openAuth(b.dataset.m,afterLogin));
  const f=$("#aForgot");if(f)f.onclick=e=>{e.preventDefault();openAuth("reset",afterLogin)};
  $("#authForm").onsubmit=async e=>{
    e.preventDefault();
    const email=$("#aEmail").value.trim(),pw=$("#aPw")?$("#aPw").value:"",msg=$("#aMsg"),go=$("#aGo");
    go.disabled=true;msg.textContent="處理中…";
    try{
      if(aMode==="login"){applySession(await authCall("token?grant_type=password",{email,password:pw}));closeModal();await afterLogin()}
      else if(aMode==="signup"){
        const name=$("#aName").value.trim();lsSet("cam_pending_name",name);
        const j=await authCall("signup?redirect_to="+encodeURIComponent(location.href.split("#")[0]),{email,password:pw,data:{display_name:name}});
        if(j.access_token){applySession(j);closeModal();await afterLogin()}
        else if(j.user&&j.user.identities&&!j.user.identities.length)msg.textContent="這個信箱已經註冊過，請直接登入。";
        else msg.textContent="已寄出確認信到 "+email+"，請點信中的連結完成驗證，再回來登入。";
      }else{
        await authCall("recover?redirect_to="+encodeURIComponent(location.href.split("#")[0]),{email});
        msg.textContent="如果這個信箱已註冊，重設連結已寄出，請到信箱查看。";
      }
    }catch(err){msg.textContent=zhErr(err)}
    go.disabled=false;
  };
}
async function authCall(path,body,method,token){
  const r=await fetch(SB_URL+"/auth/v1/"+path,{method:method||"POST",headers:{apikey:SB_KEY,"Content-Type":"application/json",Authorization:"Bearer "+(token||SB_KEY)},body:JSON.stringify(body)});
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok)throw new Error(j.msg||j.error_description||j.message||("HTTP "+r.status));
  return j;
}
function signOut(silent){
  if(AUTH&&!silent)fetch(SB_URL+"/auth/v1/logout",{method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+AUTH.access}}).catch(()=>{});
  AUTH=null;try{localStorage.removeItem("cam_auth")}catch(e){}
  if(HOOKS.onSignOut)HOOKS.onSignOut();
}
/* 驗證信或重設密碼信回來時，網址會帶 access_token */
async function handleAuthHash(){
  const hp=new URLSearchParams(location.hash.slice(1));
  if(!hp.get("access_token"))return;
  applySession({access_token:hp.get("access_token"),refresh_token:hp.get("refresh_token"),expires_in:+hp.get("expires_in")||3600});
  try{const u=await authCall("user",undefined,"GET",AUTH.access).catch(()=>null);if(u){AUTH.uid=u.id;AUTH.email=u.email;lsSet("cam_auth",AUTH)}}catch(e){}
  history.replaceState(null,"",location.pathname+location.search);
  if(hp.get("type")==="recovery")setTimeout(()=>{
    openModal(`<h2>設定新密碼 <button class="btn sm ghost" data-close>✕</button></h2><input class="f" id="npw" type="password" minlength="6" placeholder="新密碼（至少 6 個字元）"><div class="err" id="npMsg"></div><button class="btn pri" id="npGo">更新密碼</button>`);
    $("#npGo").onclick=async()=>{try{await authCall("user",{password:$("#npw").value},"PUT",AUTH.access);closeModal();toast("密碼已更新")}catch(e){$("#npMsg").textContent=zhErr(e)}};
  },300);
}
/* 是否為網站管理者（cam_admins） */
async function checkAdmin(){
  if(!AUTH)return false;
  try{return !!(await rpc("cam_is_admin"))}catch(e){return false}
}
