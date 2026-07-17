let token = localStorage.getItem('admin_token') || null;
let currentPage = 'dashboard';
let subscriptionsCache = [];

function $(id) { return document.getElementById(id); }
function val(id) { const e = $(id); return e ? e.value : ''; }
function chk(id) { const e = $(id); return e ? e.checked : false; }
function setVal(id, v) { const e = $(id); if (e) e.value = v ?? ''; }
function setChk(id, v) { const e = $(id); if (e) e.checked = !!v; }
function esc(s) { if (s == null) return ''; const m = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}; return String(s).replace(/[&<>"']/g,c=>m[c]); }
function trunc(s,n) { return (!s||s.length<=n)?s:s.slice(0,n)+'...'; }
function fmtDate(iso) { if(!iso)return'--'; return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function ago(iso) { if(!iso)return'--'; const d=Math.floor((Date.now()-new Date(iso).getTime())/1000); if(d<5)return'just now'; if(d<60)return d+'s'; if(d<3600)return Math.floor(d/60)+'m'; if(d<86400)return Math.floor(d/3600)+'h'; if(d<2592000)return Math.floor(d/86400)+'d'; return Math.floor(d/2592000)+'mo'; }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error((data && (data.error||data.message)) || 'HTTP '+res.status);
  return data;
}

function toast(msg, type) {
  const c = $('toastContainer'); if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type||'info');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }, 3000);
}

function openModal(id) { const m=$(id); if(m) m.classList.add('active'); }
function closeModalById(id) { const m=$(id); if(m) m.classList.remove('active'); }

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const el = $('page-'+page); if(el) el.classList.add('active');
  const nav = document.querySelector('.nav-item[data-page="'+page+'"]'); if(nav) nav.classList.add('active');
  loadPage(page);
}

async function loadPage(page) {
  try {
    switch(page) {
      case 'dashboard': await loadDashboard(); break;
      case 'licenses': await loadLicenses(); break;
      case 'users': await loadUsers(); break;
      case 'subscriptions': await loadSubscriptions(); break;
      case 'sessions': await loadSessions(); break;
      case 'webhooks': await loadWebhooks(); break;
      case 'files': await loadFiles(); break;
      case 'blacklist': await loadBlacklist(); break;
      case 'settings': await loadSettings(); loadConfig(); break;
    }
  } catch(e) { toast(e.message, 'error'); }
}

// Login
async function doLogin() {
  const u = val('loginUser').trim(), p = val('loginPass');
  if (!u||!p) return toast('Enter username and password','error');
  try {
    const d = await api('POST','/auth/login',{username:u,password:p});
    if (d.success && d.token) { token=d.token; localStorage.setItem('admin_token',token); showDashboard(); }
    else { const e=$('loginError'); if(e) e.textContent=d.message||'Login failed'; }
  } catch(e) {
    const e2=$('loginError');
    if(e2) {
      try { const j=JSON.parse(e.message.replace(/^HTTP \d+ /,'')); e2.textContent=j.message||e.message; }
      catch { e2.textContent=e.message; }
    }
  }
}
function doLogout() { token=null; localStorage.removeItem('admin_token'); showLogin(); }
function showLogin() { $('loginScreen').style.display=''; $('app').style.display='none'; }
function showDashboard() { $('loginScreen').style.display='none'; $('app').style.display=''; switchPage('dashboard'); }
async function checkToken() {
  if(!token){showLogin();return;}
  try { await api('GET','/stats'); showDashboard(); } catch { token=null; localStorage.removeItem('admin_token'); showLogin(); }
}

// Dashboard
async function loadDashboard() {
  const stats = await api('GET','/stats');
  const s=(id,v)=>{const e=$(id);if(e)e.textContent=v??0;};
  s('stat-total-licenses',stats.totalLicenses);
  s('stat-used',stats.usedLicenses);
  s('stat-unused',stats.unusedLicenses);
  s('stat-banned',stats.bannedLicenses);
  s('stat-users',stats.totalUsers);
  s('stat-active-users',stats.activeUsers);
  s('stat-sessions',stats.activeSessions);
  s('stat-files',stats.totalFiles);
  s('stat-webhooks',stats.totalWebhooks);
  const feed=$('activityFeed');
  if(!feed)return;
  const act = stats.recentActivity || [];
  if(!act.length){feed.innerHTML='<div class="empty-state">No recent activity</div>';return;}
  feed.innerHTML=act.map(a=>'<div class="activity-item"><span class="activity-action">'+esc(a.action)+'</span><span class="activity-detail">'+esc(a.detail||'')+'</span><span class="activity-time">'+ago(a.time)+'</span></div>').join('');
}

// Licenses
let licensesData = [];
async function loadLicenses() { licensesData=await api('GET','/licenses'); await loadSubscriptionsCache(); renderLicenses(licensesData); populateSubDropdowns(subscriptionsCache); }
function renderLicenses(list) {
  const b=$('licensesBody'); if(!b)return;
  if(!list.length){b.innerHTML='<tr><td colspan="7" class="empty-state">No licenses</td></tr>';return;}
  b.innerHTML=list.map(l=>{
    const st=l.banned?'banned':(l.status||'unused');
    const bc=st==='banned'?'badge-banned':st==='used'?'badge-used':'badge-unused';
    return '<tr><td><span class="key-text" onclick="copyKey(\''+esc(l.key)+'\')">'+esc(trunc(l.key,24))+'</span></td><td><span class="badge '+bc+'">'+st+'</span></td><td>'+esc(l.subscription||'--')+'</td><td>'+(l.useCount||0)+' / '+(l.maxUses||'&#8734;')+'</td><td>'+esc(l.notes||'--')+'</td><td>'+fmtDate(l.expiresAt)+'</td><td style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn btn-sm btn-outline" onclick="copyKey(\''+esc(l.key)+'\')">Copy</button><button class="btn btn-sm '+(l.banned?'btn-green':'btn-warn')+'" onclick="toggleBanLicense(\''+l.id+'\','+(!l.banned)+')">'+(l.banned?'Unban':'Ban')+'</button><button class="btn btn-sm btn-outline" onclick="resetLicense(\''+l.id+'\')">Reset</button><button class="btn btn-sm btn-danger" onclick="deleteLicense(\''+l.id+'\')">Del</button></td></tr>';
  }).join('');
}
function filterLicenses() { const q=(val('licenseSearch')||'').toLowerCase(); renderLicenses(q?licensesData.filter(l=>(l.key||'').toLowerCase().includes(q)||(l.subscription||'').toLowerCase().includes(q)||(l.notes||'').toLowerCase().includes(q)):licensesData); }
async function createLicense() {
  const body={count:parseInt(val('licCount')||'1',10),mask:val('licMask')||undefined,subscription:val('licSubscription')||undefined,expiryValue:parseInt(val('licExpiryValue')||'0',10)||undefined,expiryUnit:val('licExpiryUnit')||undefined,notes:val('licNotes')||undefined,maxUses:parseInt(val('licMaxUses')||'0',10)||undefined};
  try{const r=await api('POST','/licenses',body);toast('Created '+r.count+' license(s)','success');closeModalById('createLicenseModal');await loadLicenses();}catch(e){toast(e.message,'error');}
}
async function toggleBanLicense(id,ban){try{await api('PUT','/licenses/'+id,{banned:ban});toast(ban?'Banned':'Unbanned','success');await loadLicenses();}catch(e){toast(e.message,'error');}}
async function resetLicense(id){if(!confirm('Reset this license?'))return;try{await api('POST','/licenses/'+id+'/reset');toast('Reset','success');await loadLicenses();}catch(e){toast(e.message,'error');}}
async function deleteLicense(id){if(!confirm('Delete this license?'))return;try{await api('DELETE','/licenses/'+id);toast('Deleted','success');await loadLicenses();}catch(e){toast(e.message,'error');}}

// Users
let usersData = [];
async function loadUsers(){usersData=await api('GET','/users');renderUsers(usersData);}
function renderUsers(list){
  const b=$('usersBody');if(!b)return;
  if(!list.length){b.innerHTML='<tr><td colspan="7" class="empty-state">No users</td></tr>';return;}
  b.innerHTML=list.map(u=>'<tr><td>'+esc(trunc(u.username,16))+'</td><td><span class="key-text" onclick="copyKey(\''+esc(u.license||'')+'\')">'+esc(trunc(u.license||'--',16))+'</span></td><td>'+esc(trunc(u.hwid||'--',16))+'</td><td>'+esc(u.ip||'--')+'</td><td>'+esc(u.subscription||'--')+'</td><td><span class="badge '+(u.banned?'badge-banned':'badge-used')+'">'+(u.banned?'Banned':'Active')+'</span></td><td style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn btn-sm '+(u.banned?'btn-green':'btn-warn')+'" onclick="toggleBanUser(\''+u.id+'\','+(!u.banned)+')">'+(u.banned?'Unban':'Ban')+'</button><button class="btn btn-sm btn-outline" onclick="resetHwidUser(\''+u.id+'\')">HWID</button><button class="btn btn-sm btn-outline" onclick="editUserNotes(\''+u.id+'\',\''+esc(u.notes||'')+'\')">Notes</button><button class="btn btn-sm btn-danger" onclick="deleteUser(\''+u.id+'\')">Del</button></td></tr>').join('');
}
function filterUsers(){const q=(val('userSearch')||'').toLowerCase();renderUsers(q?usersData.filter(u=>(u.username||'').toLowerCase().includes(q)||(u.license||'').toLowerCase().includes(q)||(u.ip||'').toLowerCase().includes(q)):usersData);}
async function toggleBanUser(id,ban){try{await api('PUT','/users/'+id,{banned:ban});toast(ban?'Banned':'Unbanned','success');await loadUsers();}catch(e){toast(e.message,'error');}}
async function resetHwidUser(id){if(!confirm('Reset HWID?'))return;try{await api('POST','/users/'+id+'/resethwid');toast('HWID reset','success');await loadUsers();}catch(e){toast(e.message,'error');}}
function editUserNotes(id,cur){const v=prompt('Notes:',cur);if(v===null)return;api('PUT','/users/'+id,{notes:v}).then(()=>{toast('Notes updated','success');loadUsers();}).catch(e=>toast(e.message,'error'));}
async function deleteUser(id){if(!confirm('Delete user?'))return;try{await api('DELETE','/users/'+id);toast('Deleted','success');await loadUsers();}catch(e){toast(e.message,'error');}}

// Subscriptions
async function loadSubscriptionsCache(){try{subscriptionsCache=await api('GET','/subscriptions');}catch{subscriptionsCache=[];}}
async function loadSubscriptions(){const subs=await api('GET','/subscriptions');subscriptionsCache=subs;renderSubscriptions(subs);}
function renderSubscriptions(subs){
  const g=$('subscriptionsGrid');if(!g)return;
  if(!subs.length){g.innerHTML='<div class="empty-state">No subscriptions</div>';return;}
  g.innerHTML=subs.map(s=>'<div class="card"><div class="card-header"><h3>'+esc(s.name)+'</h3><button class="btn btn-sm btn-danger" onclick="deleteSubscription(\''+s.id+'\')">Delete</button></div><div class="info-row"><span>Duration</span><span>'+s.duration+' '+esc(s.durationUnit||'days')+'</span></div><div class="info-row"><span>Max Users</span><span>'+(s.maxUsers||'&#8734;')+'</span></div><div class="info-row"><span>Created</span><span>'+fmtDate(s.createdAt)+'</span></div></div>').join('');
}
function populateSubDropdowns(subs){const sel=$('licSubscription');if(sel){sel.innerHTML='<option value="">None</option>'+subs.map(s=>'<option value="'+esc(s.name)+'">'+esc(s.name)+'</option>').join('');}}
async function createSubscription(){const n=val('subName').trim();if(!n)return toast('Name required','error');try{await api('POST','/subscriptions',{name:n,duration:parseInt(val('subDuration')||'30',10),durationUnit:val('subUnit')||'days',maxUsers:parseInt(val('subMaxUsers')||'0',10)||0});toast('Created','success');closeModalById('createSubModal');await loadSubscriptions();}catch(e){toast(e.message,'error');}}
async function deleteSubscription(id){if(!confirm('Delete subscription?'))return;try{await api('DELETE','/subscriptions/'+id);toast('Deleted','success');await loadSubscriptions();}catch(e){toast(e.message,'error');}}

// Sessions
async function loadSessions(){
  const sessions=await api('GET','/sessions');const b=$('sessionsBody');if(!b)return;
  if(!sessions.length){b.innerHTML='<tr><td colspan="6" class="empty-state">No active sessions</td></tr>';return;}
  b.innerHTML=sessions.map(s=>'<tr><td>'+esc(s.user||'--')+'</td><td>'+esc(s.ip||'--')+'</td><td>'+esc(trunc(s.hwid||'--',16))+'</td><td>'+fmtDate(s.createdAt)+'</td><td>'+fmtDate(s.expiresAt)+'</td><td><button class="btn btn-sm btn-danger" onclick="deleteSession(\''+s.id+'\')">Revoke</button></td></tr>').join('');
}
async function deleteSession(id){try{await api('DELETE','/sessions/'+id);toast('Revoked','success');await loadSessions();}catch(e){toast(e.message,'error');}}
async function deleteAllSessions(){if(!confirm('Revoke ALL sessions?'))return;try{await api('DELETE','/sessions/all');toast('All revoked','success');await loadSessions();}catch(e){toast(e.message,'error');}}

// Webhooks
async function loadWebhooks(){
  const hooks=await api('GET','/webhooks');const g=$('webhooksGrid');if(!g)return;
  if(!hooks.length){g.innerHTML='<div class="empty-state">No webhooks</div>';return;}
  g.innerHTML=hooks.map(w=>'<div class="card"><div class="card-header"><h3 style="font-size:0.9rem">'+esc(trunc(w.url,40))+'</h3><div class="card-actions"><button class="btn btn-sm '+(w.enabled?'btn-green':'btn-outline')+'" onclick="toggleWebhook(\''+w.id+'\','+(!w.enabled)+')">'+(w.enabled?'On':'Off')+'</button><button class="btn btn-sm btn-danger" onclick="deleteWebhook(\''+w.id+'\')">Del</button></div></div><div class="info-row"><span>Events</span><span>'+esc((w.events||[]).join(', ')||'all')+'</span></div><div class="info-row"><span>Created</span><span>'+fmtDate(w.createdAt)+'</span></div><button class="btn btn-sm btn-outline" onclick="testWebhook(\''+w.id+'\')" style="margin-top:8px">Test</button></div>').join('');
}
async function createWebhook(){const u=val('whUrl').trim();if(!u)return toast('URL required','error');const ev=val('whEvents').trim();try{await api('POST','/webhooks',{url:u,events:ev?ev.split(',').map(e=>e.trim()):[]});toast('Created','success');closeModalById('createWebhookModal');await loadWebhooks();}catch(e){toast(e.message,'error');}}
async function toggleWebhook(id,en){try{await api('PUT','/webhooks/'+id,{enabled:en});toast(en?'Enabled':'Disabled','success');await loadWebhooks();}catch(e){toast(e.message,'error');}}
async function testWebhook(id){try{await api('POST','/webhooks/'+id+'/test');toast('Test sent','success');}catch(e){toast(e.message,'error');}}
async function deleteWebhook(id){if(!confirm('Delete webhook?'))return;try{await api('DELETE','/webhooks/'+id);toast('Deleted','success');await loadWebhooks();}catch(e){toast(e.message,'error');}}

// Files
async function loadFiles(){
  const files=await api('GET','/files');const g=$('filesGrid');if(!g)return;
  if(!files.length){g.innerHTML='<div class="empty-state">No files</div>';return;}
  g.innerHTML=files.map(f=>'<div class="card"><div class="card-header"><h3>'+esc(f.name)+'</h3><div class="card-actions"><button class="btn btn-sm btn-outline" onclick="editFile(\''+f.id+'\',\''+esc(f.name)+'\',\''+esc(f.url||'')+'\',\''+esc(f.version||'')+'\',\''+esc(f.notes||'')+'\')">Edit</button><button class="btn btn-sm btn-danger" onclick="deleteFile(\''+f.id+'\')">Del</button></div></div><div class="info-row"><span>URL</span><span class="key-text" onclick="copyKey(\''+esc(f.url||'')+'\')">'+esc(trunc(f.url||'--',36))+'</span></div><div class="info-row"><span>Version</span><span>'+esc(f.version||'--')+'</span></div><div class="info-row"><span>Downloads</span><span>'+(f.downloads||0)+'</span></div><div class="info-row"><span>Notes</span><span>'+esc(f.notes||'--')+'</span></div><div class="info-row"><span>Created</span><span>'+fmtDate(f.createdAt)+'</span></div></div>').join('');
}
async function createFile(){const n=val('fileName').trim();if(!n)return toast('Name required','error');try{await api('POST','/files',{name:n,url:val('fileUrl').trim(),version:val('fileVersion').trim(),notes:val('fileNotes').trim()});toast('Uploaded','success');closeModalById('uploadFileModal');await loadFiles();}catch(e){toast(e.message,'error');}}
function editFile(id,name,url,version,notes){setVal('fileEditId',id);setVal('fileEditName',name);setVal('fileEditUrl',url);setVal('fileEditVersion',version);setVal('fileEditNotes',notes);openModal('editFileModal');}
async function saveEditFile(){const id=val('fileEditId');try{await api('PUT','/files/'+id,{name:val('fileEditName').trim(),url:val('fileEditUrl').trim(),version:val('fileEditVersion').trim(),notes:val('fileEditNotes').trim()});toast('Updated','success');closeModalById('editFileModal');await loadFiles();}catch(e){toast(e.message,'error');}}
async function deleteFile(id){if(!confirm('Delete file?'))return;try{await api('DELETE','/files/'+id);toast('Deleted','success');await loadFiles();}catch(e){toast(e.message,'error');}}

// Blacklist
let blacklistData = [];
async function loadBlacklist(){blacklistData=await api('GET','/blacklist');renderBlacklist(blacklistData);}
function renderBlacklist(list){
  const b=$('blacklistBody');if(!b)return;
  if(!list.length){b.innerHTML='<tr><td colspan="5" class="empty-state">No entries</td></tr>';return;}
  b.innerHTML=list.map(x=>'<tr><td><span class="badge badge-'+(x.type==='ip'?'unused':x.type==='hwid'?'used':'banned')+'">'+esc(x.type)+'</span></td><td><span class="key-text" onclick="copyKey(\''+esc(x.value)+'\')">'+esc(x.value)+'</span></td><td>'+esc(x.reason||'--')+'</td><td>'+fmtDate(x.createdAt)+'</td><td><button class="btn btn-sm btn-danger" onclick="deleteBlacklist(\''+x.id+'\')">Delete</button></td></tr>').join('');
}
function filterBlacklist(){const q=(val('blacklistSearch')||'').toLowerCase();renderBlacklist(q?blacklistData.filter(x=>(x.type||'').toLowerCase().includes(q)||(x.value||'').toLowerCase().includes(q)||(x.reason||'').toLowerCase().includes(q)):blacklistData);}
async function createBlacklist(){const v=val('blValue').trim();if(!v)return toast('Value required','error');try{await api('POST','/blacklist',{type:val('blType'),value:v,reason:val('blReason').trim()});toast('Added','success');closeModalById('addBlacklistModal');await loadBlacklist();}catch(e){toast(e.message,'error');}}
async function deleteBlacklist(id){if(!confirm('Remove?'))return;try{await api('DELETE','/blacklist/'+id);toast('Removed','success');await loadBlacklist();}catch(e){toast(e.message,'error');}}

// Settings
let settingsData = {};
async function loadSettings(){
  settingsData=await api('GET','/settings');const s=settingsData;
  setChk('setAppStatus',s.appStatus);setChk('setHwidLock',s.hwidLock);setChk('setForceHwid',s.forceHwid);
  setChk('setVpnBlock',s.vpnBlock);setChk('setHashCheck',s.hashCheck);setChk('setTokenValidation',s.tokenValidation);
  setChk('setAllowRegister',s.allowRegister);setChk('setCustomerPanel',s.customerPanel);
  setChk('setShowIPs',s.showIPs);
  setVal('setAppVersion',s.appVersion);setVal('setUpdateUrl',s.updateUrl);setVal('setMinUsername',s.minUsernameLength);
  setVal('setSessionDuration',s.sessionDurationHours);
}
async function saveMainSettings(){
  try{await api('PUT','/settings',{appStatus:chk('setAppStatus'),hwidLock:chk('setHwidLock'),forceHwid:chk('setForceHwid'),vpnBlock:chk('setVpnBlock'),hashCheck:chk('setHashCheck'),tokenValidation:chk('setTokenValidation'),allowRegister:chk('setAllowRegister'),customerPanel:chk('setCustomerPanel'),showIPs:chk('setShowIPs'),appVersion:val('setAppVersion').trim(),updateUrl:val('setUpdateUrl').trim(),minUsernameLength:parseInt(val('setMinUsername')||'3',10),sessionDurationHours:parseInt(val('setSessionDuration')||'24',10)});toast('Settings saved','success');}catch(e){toast(e.message,'error');}
}

// Config
async function loadConfig(){try{const c=await api('GET','/config');setVal('cfgDiscordToken',c.discordToken);setVal('cfgOwnerId',c.discordOwnerId);setVal('cfgBotApiKey',c.botApiAdminKey);setChk('cfgBotEnabled',c.botEnabled);}catch{}}
async function saveConfig(){try{await api('PUT','/config',{discordToken:val('cfgDiscordToken'),discordOwnerId:val('cfgOwnerId'),botApiAdminKey:val('cfgBotApiKey'),botEnabled:chk('cfgBotEnabled')});toast('Config saved','success');}catch(e){toast(e.message,'error');}}

// Clipboard
function copyKey(k){navigator.clipboard.writeText(k).then(()=>toast('Copied!','success')).catch(()=>toast('Copy failed','error'));}

// Init
document.addEventListener('DOMContentLoaded',()=>{
  const f=$('loginForm');if(f) f.addEventListener('submit',e=>{e.preventDefault();doLogin();});
  const lo=$('logoutBtn');if(lo) lo.addEventListener('click',doLogout);
  document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',e=>{e.preventDefault();switchPage(n.dataset.page);}));
  checkToken();
});
