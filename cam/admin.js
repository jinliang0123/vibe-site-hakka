/* 拍照學客語・管理者介面：各組統計、投稿審核、資料下載與上傳（備份、訓練資料包） */
const VOCAB=(window.OBJ_VOCAB||{V:[]}).V;
/* 可匯出匯入的資料表；pk 用於上傳時合併（相同主鍵就更新） */
const TABLES=[
  {t:"cam_profiles",n:"會員設定",pk:"user_id",order:"updated_at.desc"},
  {t:"cam_groups",n:"群組",pk:"id",order:"created_at"},
  {t:"cam_group_members",n:"群組成員",pk:"group_id,user_id",order:"joined_at"},
  {t:"cam_favorites",n:"我的最愛",pk:"id",order:"created_at",files:["image_path"]},
  {t:"cam_contributions",n:"使用者投稿",pk:"id",order:"created_at",files:["image_path","audio_path"]},
  {t:"cam_activity",n:"練習紀錄",pk:"id",order:"created_at",noId:true}
];
const ST={pending:"待審核",accepted:"已採用",rejected:"未採用"};
const ISSUES={ocr:"文字辨識錯字",pron:"拼音（讀音）錯誤",audio:"發音錄音錯誤",gloss:"解釋錯誤",other:"其他"};

/* ================= 進入點 ================= */
async function boot(){
  $("#btnAuth").textContent=AUTH?"👤 "+AUTH.email.split("@")[0]:"登入";
  if(!AUTH||!(await ensureToken())){
    $("#app").classList.add("hide");
    $("#gate").innerHTML=`請先用管理者帳號登入。<br><br><button class="btn pri" id="gLogin">登入</button>`;$("#gate").classList.remove("hide");
    $("#gLogin").onclick=()=>openAuth("login",boot);return;
  }
  if(!(await checkAdmin())){
    $("#app").classList.add("hide");
    $("#gate").innerHTML=`這個帳號（${esc(AUTH.email)}）不是網站管理者。<br><span class="muted">管理者名單在資料表 cam_admins，請由現有管理者在 Supabase SQL Editor 加入。</span>`;
    $("#gate").classList.remove("hide");return;
  }
  $("#gate").classList.add("hide");$("#app").classList.remove("hide");
  show("stats");
}
$("#btnAuth").onclick=()=>AUTH?(confirm("確定登出？")&&signOut()):openAuth("login",boot);
HOOKS.onSignOut=boot;
document.querySelector(".atabs").onclick=e=>{const b=e.target.closest("[data-v]");if(b)show(b.dataset.v)};
function show(v){
  document.querySelectorAll(".atabs [data-v]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===v));
  ["stats","contrib","data","users"].forEach(x=>$("#v-"+x).classList.toggle("hide",x!==v));
  ({stats:renderStats,contrib:renderContrib,data:renderData,users:renderUsers})[v]();
}

/* ================= 共用：取全部資料、CSV、下載 ================= */
async function fetchAll(table,query,order){
  const out=[];
  for(let off=0;;off+=1000){
    const rows=await api(`${table}?select=*${query?"&"+query:""}&order=${order||"created_at"}&limit=1000&offset=${off}`);
    out.push(...rows);if(rows.length<1000)break;
  }
  return out;
}
function toCSV(rows,cols){
  cols=cols||[...new Set(rows.flatMap(r=>Object.keys(r)))];
  const cell=v=>{if(v==null)return "";if(typeof v==="object")v=JSON.stringify(v);v=String(v);return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  return "﻿"+[cols.join(",")].concat(rows.map(r=>cols.map(c=>cell(r[c])).join(","))).join("\r\n");
}
function saveBlob(blob,name){
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
}
const stamp=()=>{const d=new Date();return d.getFullYear()+p2(d.getMonth()+1)+p2(d.getDate())+"-"+p2(d.getHours())+p2(d.getMinutes())};
const saveJSON=(obj,name)=>saveBlob(new Blob([JSON.stringify(obj,null,1)],{type:"application/json"}),name);
const saveCSV=(rows,name,cols)=>saveBlob(new Blob([toCSV(rows,cols)],{type:"text/csv;charset=utf-8"}),name);
const n0=v=>v==null?0:v;
const bar=(v,max,cls)=>`<span class="bar ${cls||""}" style="width:${max?Math.round(v/max*80):0}px"></span>`;

/* ================= 統計 ================= */
let STATS=null;
async function renderStats(days){
  days=days||(STATS&&STATS.days)||7;
  const box=$("#v-stats");
  box.innerHTML=`<div class="busy"><div class="spin"></div>統計中…</div>`;
  let groups=[],daily=[],users=[];
  try{[groups,daily,users]=await Promise.all([rpc("cam_admin_group_stats",{p_days:days}),rpc("cam_admin_daily",{p_days:30}),rpc("cam_admin_users")])}
  catch(e){box.innerHTML=`<p class="err">${esc(zhErr(e))}</p>`;return}
  STATS={days,groups,daily,users};
  const sum=k=>groups.reduce((a,g)=>a+n0(g[k]),0);
  const realGroups=groups.filter(g=>g.group_id);
  const kpi=(v,l)=>`<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  const maxD=Math.max(1,...daily.map(d=>d.scans_object+d.scans_text+d.reviews));
  box.innerHTML=`<div class="kpis">
      ${kpi(users.length,"註冊會員")}${kpi(realGroups.length,"群組")}
      ${kpi(sum("fav_object"),"📦 物件收藏")}${kpi(sum("fav_text"),"🔤 文字收藏")}
      ${kpi(sum("reviews_total"),"累計複習次數")}
      ${kpi(sum("contrib_object"),"📦 物件投稿")}${kpi(sum("contrib_text"),"🔤 錯誤回報")}${kpi(sum("contrib_pending"),"待審核投稿")}
      ${kpi(sum("scans_recent"),`近 ${days} 天拍照辨識`)}${kpi(sum("reviews_recent"),`近 ${days} 天複習`)}
    </div>
    <div class="card">
      <div class="row"><h2 class="grow" style="font-size:18px;margin:0">各組收集與練習統計</h2>
        <select class="btn sm" id="stDays">${[7,30,90,365].map(d=>`<option value="${d}" ${d===days?"selected":""}>近 ${d} 天</option>`).join("")}</select>
        <button class="btn sm" id="stCsv">⬇️ 下載 CSV</button></div>
      <p class="muted">點一列可看該組每位成員的進度。「近期」欄位依右上角的天數計算。</p>
      <div class="tbl"><table>
        <tr><th>群組</th><th class="n">成員</th><th class="n">📦收藏</th><th class="n">🔤收藏</th><th class="n">累計複習</th><th class="n">完成5次</th><th class="n">待複習</th><th class="n">📦投稿</th><th class="n">🔤回報</th><th class="n">待審</th><th class="n">近期拍照</th><th class="n">近期複習</th><th class="n">活躍人數</th><th>最後活動</th></tr>
        ${groups.map(g=>`<tr class="${g.group_id?"click":""}" data-g="${g.group_id||""}"><td><b>${esc(g.group_name)}</b>${g.owner_email?`<br><span class="muted">${esc(g.owner_email)}・${esc(g.join_code)}</span>`:""}</td>
          <td class="n">${g.members}</td><td class="n">${g.fav_object}</td><td class="n">${g.fav_text}</td><td class="n">${g.reviews_total}</td><td class="n">${g.finished}</td><td class="n">${g.due}</td>
          <td class="n">${g.contrib_object}</td><td class="n">${g.contrib_text}</td><td class="n">${g.contrib_pending}</td><td class="n">${g.scans_recent}</td><td class="n">${g.reviews_recent}</td><td class="n">${g.active_users_recent}</td><td>${fmtT(g.last_active)}</td></tr>`).join("")}
      </table></div>
      <p class="muted">一個人可能同時在多個群組，所以各列加總可能大於上方總數。</p>
    </div>
    <div class="card">
      <div class="row"><h2 class="grow" style="font-size:18px;margin:0">近 30 天每日活動</h2><button class="btn sm" id="dyCsv">⬇️ 下載 CSV</button></div>
      <div class="tbl"><table>
        <tr><th>日期</th><th class="n">📦拍照</th><th class="n">🔤拍照</th><th class="n">複習</th><th class="n">新收藏</th><th class="n">投稿</th><th class="n">活躍人數</th><th></th></tr>
        ${daily.slice().reverse().map(d=>`<tr><td>${esc(d.day)}</td><td class="n">${d.scans_object}</td><td class="n">${d.scans_text}</td><td class="n">${d.reviews}</td><td class="n">${d.favorites}</td><td class="n">${d.contributions}</td><td class="n">${d.active_users}</td>
          <td>${bar(d.scans_object+d.scans_text,maxD)} ${bar(d.reviews,maxD,"b2")}</td></tr>`).join("")}
      </table></div>
      <p class="muted"><span class="bar" style="width:12px"></span> 拍照辨識　<span class="bar b2" style="width:12px"></span> 複習（只記錄登入使用者）</p>
    </div>`;
  $("#stDays").onchange=e=>renderStats(+e.target.value);
  $("#stCsv").onclick=()=>saveCSV(groups,`各組統計-近${days}天-${stamp()}.csv`);
  $("#dyCsv").onclick=()=>saveCSV(daily,`每日活動-${stamp()}.csv`);
  box.querySelectorAll("tr.click").forEach(tr=>tr.onclick=()=>openGroup(tr.dataset.g));
}
async function openGroup(gid){
  const g=STATS.groups.find(x=>x.group_id===gid);
  openModal(`<h2>${esc(g.group_name)} <button class="btn sm ghost" data-close>✕</button></h2><div id="gpBody"><div class="busy"><div class="spin"></div>載入中…</div></div>`);
  let ms=[];
  try{ms=await rpc("cam_group_progress",{p_group:gid})}catch(e){$("#gpBody").innerHTML=`<p class="err">${esc(zhErr(e))}</p>`;return}
  const ROLE={owner:"擁有者",admin:"管理員",member:"成員"};
  $("#gpBody").innerHTML=`<div class="tbl"><table><tr><th>成員</th><th>角色</th><th class="n">📦</th><th class="n">🔤</th><th class="n">複習</th><th class="n">完成</th><th class="n">待複習</th><th class="n">投稿</th><th>最後活動</th></tr>
    ${ms.map(m=>`<tr><td>${esc(m.display_name)}<br><span class="muted">${esc(m.email)}</span></td><td>${ROLE[m.role]}</td><td class="n">${m.fav_object}</td><td class="n">${m.fav_text}</td><td class="n">${m.reviews}</td><td class="n">${m.finished}</td><td class="n">${m.due}</td><td class="n">${m.contrib_object+m.contrib_text}</td><td>${fmtT(m.last_active)}</td></tr>`).join("")}
    </table></div><div class="row" style="margin-top:10px"><button class="btn sm" id="gpCsv">⬇️ 下載成員進度 CSV</button></div>`;
  $("#gpCsv").onclick=()=>saveCSV(ms,`${g.group_name}-成員進度-${stamp()}.csv`);
}

/* ================= 投稿審核 ================= */
let CF={kind:"all",status:"pending"},CROWS=[],NAMES={};
async function renderContrib(){
  const box=$("#v-contrib");
  box.innerHTML=`<div class="card row">
      <select class="btn sm" id="cfKind"><option value="all">全部類型</option><option value="object">📦 物件客語資料</option><option value="text">🔤 文字錯誤回報</option></select>
      <select class="btn sm" id="cfStatus"><option value="pending">待審核</option><option value="accepted">已採用</option><option value="rejected">未採用</option><option value="all">全部狀態</option></select>
      <span class="grow muted" id="cfCount"></span>
      <button class="btn sm" id="cfCsv">⬇️ 目前清單 CSV</button>
    </div><div id="cfList"><div class="busy"><div class="spin"></div>載入中…</div></div>`;
  $("#cfKind").value=CF.kind;$("#cfStatus").value=CF.status;
  $("#cfKind").onchange=e=>{CF.kind=e.target.value;renderContrib()};
  $("#cfStatus").onchange=e=>{CF.status=e.target.value;renderContrib()};
  const q=[CF.kind!=="all"?"kind=eq."+CF.kind:"",CF.status!=="all"?"status=eq."+CF.status:""].filter(Boolean).join("&");
  try{
    CROWS=await fetchAll("cam_contributions",q,"created_at.desc");
    if(!Object.keys(NAMES).length)(await rpc("cam_admin_users")).forEach(u=>NAMES[u.user_id]=u.display_name||u.email);
  }catch(e){$("#cfList").innerHTML=`<p class="err">${esc(zhErr(e))}</p>`;return}
  $("#cfCount").textContent=`共 ${CROWS.length} 筆`;
  $("#cfCsv").onclick=()=>saveCSV(CROWS.map(r=>Object.assign({contributor:NAMES[r.user_id]||""},r)),`投稿-${stamp()}.csv`);
  if(!CROWS.length){$("#cfList").innerHTML=`<p class="empty">沒有符合條件的投稿。</p>`;return}
  const show=CROWS.slice(0,120);
  $("#cfList").innerHTML=`<div class="cgrid">${show.map(contribCard).join("")}</div>${CROWS.length>show.length?`<p class="muted">只顯示前 ${show.length} 筆，完整資料請用下載。</p>`:""}`;
  await signFiles(show.flatMap(r=>[r.image_path,r.audio_path]));
  $("#cfList").querySelectorAll("[data-img]").forEach(el=>{el.src=fileUrl(el.dataset.img)});
  $("#cfList").onclick=onContribClick;
}
function contribCard(r){
  const v=r.concept!=null&&VOCAB[r.concept]?VOCAB[r.concept]:null;
  return `<div class="citem" data-id="${r.id}">
    <div class="row"><span class="grow"><span class="kind ${r.kind}">${r.kind==="object"?"📦 物件":"🔤 回報"}</span> <span class="st ${r.status}">${ST[r.status]}</span></span><span class="muted">${fmtDT(r.created_at)}</span></div>
    ${r.image_path?`<div class="photo" style="margin-top:6px"><div class="pin"><img class="thumb" data-img="${esc(r.image_path)}" alt="">${r.box?`<div class="box" style="left:${pct(r.box[0])};top:${pct(r.box[1])};width:${pct(r.box[2])};height:${pct(r.box[3])}"></div>`:""}</div></div>`:""}
    <div class="muted" style="margin-top:4px">投稿者：${esc(NAMES[r.user_id]||r.user_id.slice(0,8))}・${DN(r.dialect)}</div>
    ${r.kind==="object"?`<div class="muted">系統辨識：${v?esc(v.zh+"（"+v.hk+"）"):"無／新物品"}${r.label?"・"+esc(r.label):""}</div>`
      :`<div class="muted">${esc(ISSUES[r.issue]||"")}・原本：<b>${esc(r.orig_text||"")}</b> ${esc(r.orig_pron||"")}</div>`}
    ${r.kind==="object"?`<label class="f">國語名稱</label><input class="f" data-f="zh" maxlength="60" value="${esc(r.zh||"")}">`:""}
    <label class="f">客語漢字</label><input class="f" data-f="hanzi" maxlength="60" value="${esc(r.hanzi)}">
    <label class="f">客語拼音</label><input class="f" data-f="pinyin" maxlength="200" value="${esc(r.pinyin||"")}">
    ${r.note?`<div class="note">使用者說明：${esc(r.note)}</div>`:""}
    <label class="f">回覆投稿者（選填）</label><input class="f" data-f="admin_note" maxlength="300" value="${esc(r.admin_note||"")}">
    <div class="row" style="margin-top:8px">${r.audio_path?`<button class="btn sm" data-a="play" data-src="${esc(r.audio_path)}">▶️ 錄音</button>`:`<span class="muted">（無錄音）</span>`}<span class="grow"></span>
      <button class="btn sm pri" data-a="accepted">✅ 採用</button><button class="btn sm" data-a="rejected">✖ 不採用</button><button class="btn sm ghost" data-a="save">💾</button><button class="btn sm danger" data-a="del" title="刪除">🗑</button></div>
  </div>`;
}
async function onContribClick(e){
  const b=e.target.closest("[data-a]");if(!b)return;
  const card=b.closest("[data-id]"),r=CROWS.find(x=>x.id===card.dataset.id),a=b.dataset.a;
  if(a==="play"){await signFiles([b.dataset.src]);stopAll();const tok=playToken;markBtn(b);await playOne(fileUrl(b.dataset.src),tok);if(tok===playToken)markBtn(null);return}
  if(a==="del"){
    if(!confirm("確定永久刪除這筆投稿與它的照片、錄音？"))return;
    try{await api("cam_contributions?id=eq."+r.id,{method:"DELETE"});await removeFiles([r.image_path,r.audio_path]);CROWS=CROWS.filter(x=>x!==r);card.remove();toast("已刪除")}catch(err){toast(zhErr(err))}
    return;
  }
  const patch={};card.querySelectorAll("[data-f]").forEach(i=>{const v=i.value.trim();patch[i.dataset.f]=v||null});
  if(!patch.hanzi){toast("客語漢字不能空白");return}
  if(a!=="save")Object.assign(patch,{status:a,reviewed_by:AUTH.uid,reviewed_at:new Date().toISOString()});
  try{
    await api("cam_contributions?id=eq."+r.id,{method:"PATCH",body:patch});Object.assign(r,patch);
    if(a==="save")toast("已儲存");
    else{toast(a==="accepted"?"已採用":"已標示為不採用");if(CF.status!=="all"&&CF.status!==a){card.remove();CROWS=CROWS.filter(x=>x!==r);$("#cfCount").textContent=`共 ${CROWS.length} 筆`}else card.outerHTML=contribCard(r)}
  }catch(err){toast(zhErr(err))}
}

/* ================= 資料下載／上傳 ================= */
function renderData(){
  $("#v-data").innerHTML=`<div class="card">
      <h2 style="font-size:18px;margin:0 0 6px">⬇️ 下載單一資料表</h2>
      <div class="tbl"><table><tr><th>資料表</th><th>內容</th><th></th></tr>
        ${TABLES.map(x=>`<tr><td><code>${x.t}</code></td><td>${x.n}</td><td style="white-space:nowrap"><button class="btn sm" data-dl="${x.t}" data-fmt="json">JSON</button> <button class="btn sm" data-dl="${x.t}" data-fmt="csv">CSV</button></td></tr>`).join("")}
      </table></div>
    </div>
    <div class="card">
      <h2 style="font-size:18px;margin:0 0 6px">📦 打包下載</h2>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <button class="btn" id="pkFull">🗄️ 完整備份 ZIP（所有資料表＋照片＋錄音）</button>
        <button class="btn" id="pkFullNoFile">🗄️ 完整備份 ZIP（只有資料表，不含檔案）</button>
        <button class="btn" id="pkTrain">🧠 影像辨識訓練資料包（已採用的物件投稿：照片、物品框、客語標註、錄音）</button>
        <button class="btn" id="pkFix">📝 客語更正清單（已採用的文字錯誤回報，含錄音）</button>
      </div>
      <p class="muted">訓練資料包內含 <code>labels.csv</code>、<code>labels.json</code>（每張照片的國語名稱、客語漢字、拼音、腔調、物品框 x,y,w,h 為 0~1 比例）與 <code>images/</code>、<code>audio/</code> 資料夾，可直接用來訓練或匯入其他系統。</p>
      <div class="log hide" id="pkLog"></div>
    </div>
    <div class="card">
      <h2 style="font-size:18px;margin:0 0 6px">⬆️ 上傳（匯入／還原）</h2>
      <p class="muted">可上傳「完整備份 ZIP」，或單一資料表的 JSON（從上面下載的格式）。相同主鍵的資料會被更新，其餘新增；不會刪除任何既有資料。練習紀錄會當作新紀錄加入。</p>
      <div class="drop"><label class="btn pri">選擇檔案（.zip 或 .json）<input type="file" id="upFile" accept=".zip,.json,application/zip,application/json" class="hide"></label>
        <div class="row" style="justify-content:center;margin-top:8px"><label class="muted"><input type="checkbox" id="upFiles" checked> 一併上傳 ZIP 內的照片與錄音</label></div></div>
      <div class="log hide" id="upLog"></div>
    </div>`;
  $("#v-data").querySelectorAll("[data-dl]").forEach(b=>b.onclick=async()=>{
    const x=TABLES.find(t=>t.t===b.dataset.dl);b.disabled=true;
    try{const rows=await fetchAll(x.t,"",x.order);if(b.dataset.fmt==="csv")saveCSV(rows,`${x.t}-${stamp()}.csv`);else saveJSON({table:x.t,exported_at:new Date().toISOString(),rows},`${x.t}-${stamp()}.json`)}
    catch(e){toast(zhErr(e))}
    b.disabled=false;
  });
  $("#pkFull").onclick=()=>packFull(true);
  $("#pkFullNoFile").onclick=()=>packFull(false);
  $("#pkTrain").onclick=packTrain;
  $("#pkFix").onclick=packFix;
  $("#upFile").onchange=e=>{const f=e.target.files[0];e.target.value="";if(f)importFile(f)};
}
function logger(id){
  const el=$(id);el.classList.remove("hide");el.textContent="";
  return m=>{el.textContent+=m+"\n";el.scrollTop=el.scrollHeight};
}
const extOf=p=>(p.match(/\.[a-z0-9]+$/i)||[".bin"])[0];
/* 把檔案加進 ZIP；失敗只記錄不中斷 */
async function addFiles(zip,list,log){
  let ok=0,bad=0;
  for(let i=0;i<list.length;i++){
    const [path,name]=list[i];
    try{zip.file(name,await downloadFile(path));ok++}catch(e){bad++;log("　✗ "+path+"："+e.message)}
    if((i+1)%20===0)log(`　檔案 ${i+1}/${list.length}`);
  }
  log(`　檔案完成：${ok} 個成功${bad?`、${bad} 個失敗`:""}`);
}
async function packFull(withFiles){
  if(!window.JSZip){toast("ZIP 程式庫載入失敗，請檢查網路");return}
  const log=logger("#pkLog"),zip=new JSZip(),files=[];
  log("開始備份…");
  try{
    const manifest={app:"拍照學客語",format:"cam-backup-1",exported_at:new Date().toISOString(),exported_by:AUTH.email,tables:{}};
    for(const x of TABLES){
      const rows=await fetchAll(x.t,"",x.order);
      zip.file(`data/${x.t}.json`,JSON.stringify(rows,null,1));
      manifest.tables[x.t]=rows.length;log(`${x.n}（${x.t}）：${rows.length} 筆`);
      if(withFiles&&x.files)rows.forEach(r=>x.files.forEach(k=>{if(r[k])files.push([r[k],"files/"+r[k]])}));
    }
    if(withFiles){log(`下載照片與錄音 ${files.length} 個…`);await addFiles(zip,files,log)}
    zip.file("manifest.json",JSON.stringify(manifest,null,1));
    log("壓縮中…");
    saveBlob(await zip.generateAsync({type:"blob",compression:"DEFLATE"}),`拍照學客語-完整備份-${stamp()}.zip`);
    log("✅ 完成");
  }catch(e){log("❌ "+zhErr(e))}
}
async function packTrain(){
  if(!window.JSZip){toast("ZIP 程式庫載入失敗，請檢查網路");return}
  const log=logger("#pkLog"),zip=new JSZip(),files=[];
  log("讀取已採用的物件投稿…");
  try{
    const rows=await fetchAll("cam_contributions","kind=eq.object&status=eq.accepted","created_at");
    const labels=rows.map(r=>{
      const img=r.image_path?"images/"+r.id+extOf(r.image_path):"",au=r.audio_path?"audio/"+r.id+extOf(r.audio_path):"";
      if(img)files.push([r.image_path,img]);if(au)files.push([r.audio_path,au]);
      const v=r.concept!=null&&VOCAB[r.concept]?VOCAB[r.concept]:null;
      return {id:r.id,image:img,audio:au,zh:r.zh||(v?v.zh:""),hakka:r.hanzi,pinyin:r.pinyin||"",dialect:r.dialect,dialect_name:DN(r.dialect),
        box_x:r.box?r.box[0]:"",box_y:r.box?r.box[1]:"",box_w:r.box?r.box[2]:"",box_h:r.box?r.box[3]:"",
        vocab_index:r.concept==null?"":r.concept,vocab_zh:v?v.zh:"",model_label:r.label||"",created_at:r.created_at};
    });
    log(`共 ${labels.length} 筆，下載檔案 ${files.length} 個…`);
    await addFiles(zip,files,log);
    zip.file("labels.csv",toCSV(labels));zip.file("labels.json",JSON.stringify(labels,null,1));
    zip.file("README.txt",`拍照學客語 影像辨識訓練資料包\n匯出時間：${new Date().toISOString()}\n\nlabels.csv / labels.json 欄位：\n  image 照片路徑、audio 錄音路徑、zh 國語名稱、hakka 客語漢字、pinyin 客語拼音（使用者輸入）、dialect 腔調代碼（1四縣 2海陸 3大埔 4饒平 5詔安 6南四縣）\n  box_x, box_y, box_w, box_h 物品在照片中的位置（0~1 比例，可能空白）\n  vocab_index / vocab_zh 系統原本辨識到的詞彙、model_label 模型標籤\n`);
    log("壓縮中…");
    saveBlob(await zip.generateAsync({type:"blob",compression:"DEFLATE"}),`拍照學客語-訓練資料-${stamp()}.zip`);
    log("✅ 完成");
  }catch(e){log("❌ "+zhErr(e))}
}
async function packFix(){
  if(!window.JSZip){toast("ZIP 程式庫載入失敗，請檢查網路");return}
  const log=logger("#pkLog"),zip=new JSZip(),files=[];
  log("讀取已採用的文字錯誤回報…");
  try{
    const rows=await fetchAll("cam_contributions","kind=eq.text&status=eq.accepted","created_at");
    const list=rows.map(r=>{
      const au=r.audio_path?"audio/"+r.id+extOf(r.audio_path):"",img=r.image_path?"images/"+r.id+extOf(r.image_path):"";
      if(au)files.push([r.audio_path,au]);if(img)files.push([r.image_path,img]);
      return {id:r.id,issue:ISSUES[r.issue]||r.issue||"",orig_text:r.orig_text||"",orig_pron:r.orig_pron||"",hanzi:r.hanzi,pinyin:r.pinyin||"",dialect:r.dialect,dialect_name:DN(r.dialect),note:r.note||"",admin_note:r.admin_note||"",audio:au,image:img,created_at:r.created_at};
    });
    log(`共 ${list.length} 筆，下載檔案 ${files.length} 個…`);
    await addFiles(zip,files,log);
    zip.file("corrections.csv",toCSV(list));zip.file("corrections.json",JSON.stringify(list,null,1));
    log("壓縮中…");
    saveBlob(await zip.generateAsync({type:"blob",compression:"DEFLATE"}),`拍照學客語-客語更正-${stamp()}.zip`);
    log("✅ 完成");
  }catch(e){log("❌ "+zhErr(e))}
}
/* 上傳：合併寫入（相同主鍵更新），一次 500 筆 */
async function upsert(x,rows,log){
  if(x.noId)rows=rows.map(r=>{const o=Object.assign({},r);delete o.id;return o});
  let done=0;
  for(let i=0;i<rows.length;i+=500){
    const part=rows.slice(i,i+500);
    await api(x.t+(x.noId?"":"?on_conflict="+x.pk),{method:"POST",headers:{Prefer:x.noId?"return=minimal":"resolution=merge-duplicates,return=minimal"},body:part});
    done+=part.length;
  }
  log(`${x.n}（${x.t}）：寫入 ${done} 筆`);
}
async function importFile(file){
  const log=logger("#upLog");
  log("讀取 "+file.name+"…");
  try{
    if(/\.json$/i.test(file.name)||file.type==="application/json"){
      const j=JSON.parse(await file.text());
      const t=j.table||prompt("要匯入到哪一個資料表？\n"+TABLES.map(x=>x.t).join("\n"));
      const x=TABLES.find(y=>y.t===t);if(!x)throw new Error("不認得的資料表："+t);
      const rows=Array.isArray(j)?j:j.rows;if(!Array.isArray(rows))throw new Error("檔案裡找不到資料列");
      if(!confirm(`確定把 ${rows.length} 筆資料匯入「${x.n}」？`)){log("已取消");return}
      await upsert(x,rows,log);
    }else{
      if(!window.JSZip)throw new Error("ZIP 程式庫載入失敗，請檢查網路");
      const zip=await JSZip.loadAsync(file);
      const data={};
      for(const x of TABLES){const f=zip.file(`data/${x.t}.json`);if(f)data[x.t]=JSON.parse(await f.async("string"))}
      const names=Object.keys(data);if(!names.length)throw new Error("ZIP 裡沒有 data/*.json，請確認是本系統的完整備份");
      const fileEntries=Object.keys(zip.files).filter(k=>k.startsWith("files/")&&!zip.files[k].dir);
      const withFiles=$("#upFiles").checked;
      if(!confirm(`確定匯入？\n${names.map(t=>`${t}：${data[t].length} 筆`).join("\n")}${withFiles?`\n檔案：${fileEntries.length} 個`:""}`)){log("已取消");return}
      if(withFiles&&fileEntries.length){
        log(`上傳照片與錄音 ${fileEntries.length} 個…`);let ok=0,bad=0;
        for(let i=0;i<fileEntries.length;i++){
          const k=fileEntries[i],path=k.slice(6),ext=extOf(path).slice(1).toLowerCase();
          const type={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",webm:"audio/webm",ogg:"audio/ogg",m4a:"audio/mp4",mp4:"audio/mp4",mp3:"audio/mpeg",wav:"audio/wav"}[ext]||"application/octet-stream";
          try{await uploadFile(path,new Blob([await zip.file(k).async("arraybuffer")],{type}));ok++}catch(e){bad++;log("　✗ "+path+"："+e.message)}
          if((i+1)%20===0)log(`　檔案 ${i+1}/${fileEntries.length}`);
        }
        log(`　檔案完成：${ok} 個成功${bad?`、${bad} 個失敗`:""}`);
      }
      for(const x of TABLES)if(data[x.t]&&data[x.t].length){
        try{await upsert(x,data[x.t],log)}catch(e){log(`❌ ${x.t}：${zhErr(e)}`)}
      }
    }
    log("✅ 匯入結束");
  }catch(e){log("❌ "+(e.message&&/^[^\x00-\x7f]/.test(e.message)?e.message:zhErr(e)))}
}

/* ================= 使用者 ================= */
async function renderUsers(){
  const box=$("#v-users");
  box.innerHTML=`<div class="busy"><div class="spin"></div>載入中…</div>`;
  let us=[];
  try{us=await rpc("cam_admin_users")}catch(e){box.innerHTML=`<p class="err">${esc(zhErr(e))}</p>`;return}
  box.innerHTML=`<div class="card"><div class="row"><h2 class="grow" style="font-size:18px;margin:0">會員（${us.length}）</h2><button class="btn sm" id="usCsv">⬇️ CSV</button></div>
    <div class="tbl"><table><tr><th>名稱／信箱</th><th>群組</th><th>註冊</th><th>最後登入</th><th></th></tr>
    ${us.map(u=>`<tr><td>${esc(u.display_name||"")}<br><span class="muted">${esc(u.email)}</span></td><td>${esc(u.groups||"—")}</td><td>${fmtT(u.created_at)}</td><td>${fmtT(u.last_sign_in_at)}</td><td>${u.is_admin?"🛠️ 管理者":""}</td></tr>`).join("")}
    </table></div>
    <p class="muted">新增或移除網站管理者：在 Supabase SQL Editor 執行<br><code>insert into public.cam_admins(user_id) select id from auth.users where email='對方信箱';</code></p></div>`;
  $("#usCsv").onclick=()=>saveCSV(us,`會員-${stamp()}.csv`);
}

(async()=>{await handleAuthHash();boot()})();
