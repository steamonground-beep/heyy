const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function generateKey(mask) {
    if (mask) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        return mask.split('').map(c => c === '*' ? chars[Math.floor(Math.random() * chars.length)] : c).join('');
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({length:4}, () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('')).join('-');
}
function genId() { return Math.random().toString(36).substring(2, 10); }

function readData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const rec = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (!rec.licenses) rec.licenses = [];
            if (!rec.users) rec.users = [];
            if (!rec.subscriptions) rec.subscriptions = [];
            if (!rec.activeSessions) rec.activeSessions = [];
            if (!rec.webhooks) rec.webhooks = [];
            if (!rec.blacklist) rec.blacklist = [];
            if (!rec.files) rec.files = [];
            if (!rec.updates) rec.updates = [];
            if (!rec.activity) rec.activity = [];
            if (!rec.settings) rec.settings = { appStatus:true, hwidLock:true, forceHwid:false, vpnBlock:false, hashCheck:false, tokenValidation:false, minUsernameLength:3, maxUsernameLength:32, appVersion:'1.0.0', updateUrl:'', webhookUrl:'', customerPanel:true, allowRegister:true, sessionDurationHours:24 };
            if (!rec.config) rec.config = {};
            return rec;
        }
    } catch {}
    return { licenses:[], users:[], subscriptions:[], activeSessions:[], webhooks:[], blacklist:[], files:[], updates:[], activity:[], settings:{ appStatus:true, hwidLock:true, forceHwid:false, vpnBlock:false, hashCheck:false, tokenValidation:false, minUsernameLength:3, maxUsernameLength:32, appVersion:'1.0.0', updateUrl:'', webhookUrl:'', customerPanel:true, allowRegister:true, sessionDurationHours:24 }, config:{} };
}

function writeData(data) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); return true; } catch { return false; }
}

function isAdmin(req) {
    const auth = req.headers['authorization'];
    if (!auth) return false;
    const t = auth.startsWith('Bearer ') ? auth.substring(7) : auth;
    return t === ADMIN_KEY;
}

function logActivity(data, action, detail) {
    if (!data.activity) data.activity = [];
    data.activity.unshift({ id: genId(), action, detail, time: new Date().toISOString() });
    if (data.activity.length > 200) data.activity = data.activity.slice(0, 200);
}

// ── Public routes ──────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username !== 'admin') return res.status(401).json({ success: false, message: 'Invalid credentials' });
    if (password === ADMIN_PASSWORD) return res.json({ success: true, token: ADMIN_KEY });
    const d = readData();
    const storedPw = d.config?.adminPassword;
    if (storedPw && password === storedPw) return res.json({ success: true, token: ADMIN_KEY });
    res.status(401).json({ success: false, message: 'Invalid credentials' });
});

app.post('/api/validate', (req, res) => {
    const { key, ip } = req.body;
    if (!key) return res.json({ valid: false, message: 'Key is required' });
    const data = readData();
    const k = data.licenses.find(l => l.key === key);
    if (!k) return res.json({ valid: false, message: 'Invalid license key' });
    if (k.banned) return res.json({ valid: false, message: 'License key is banned' });
    if (k.expiresAt && new Date(k.expiresAt) < new Date()) return res.json({ valid: false, message: 'License key has expired' });
    if (k.maxUses && k.useCount >= k.maxUses) return res.json({ valid: false, message: 'Max uses reached' });
    if (k.usedIp && k.usedIp !== ip) return res.json({ valid: false, message: 'Locked to different IP' });
    k.usedIp = ip; k.usedAt = k.usedAt || new Date().toISOString(); k.useCount = (k.useCount||0)+1; k.status = 'used';
    if (!data.users.find(u => u.license === key)) {
        data.users.push({ id:genId(), license:key, username:key, hwid:null, ip, registeredAt:new Date().toISOString(), lastLogin:new Date().toISOString(), subscription:k.subscription||'default', banned:false, notes:'' });
    }
    logActivity(data, 'license_used', key);
    writeData(data);
    res.json({ valid: true, message: 'License validated', lockedIp: k.usedIp });
});

app.get('/api/config/public', (req, res) => {
    const data = readData();
    const cfg = data.config || {};
    res.json({ discordToken:cfg.discordToken||'', discordOwnerId:cfg.discordOwnerId||'', botApiAdminKey:cfg.botApiAdminKey||'', botEnabled:cfg.botEnabled||false, apiUrl:'http://localhost:3001/api' });
});

// ── Auth required ──────────────────────────────────────────────────────
app.use('/api', (req, res, next) => { if (isAdmin(req)) return next(); res.status(401).json({ success:false, message:'Unauthorized' }); });

// Dashboard stats
app.get('/api/stats', (req, res) => {
    const data = readData();
    const now = new Date();
    res.json({ totalLicenses:data.licenses.length, usedLicenses:data.licenses.filter(l=>l.status==='used').length, unusedLicenses:data.licenses.filter(l=>l.status==='unused').length, bannedLicenses:data.licenses.filter(l=>l.banned).length, totalUsers:data.users.length, activeUsers:data.users.filter(u=>!u.banned).length, bannedUsers:data.users.filter(u=>u.banned).length, activeSessions:data.activeSessions.filter(s=>new Date(s.expiresAt)>now).length, totalFiles:data.files.length, totalWebhooks:data.webhooks.length, totalBlacklist:data.blacklist.length, subscriptions:data.subscriptions.length, recentActivity:data.activity.slice(0,10) });
});

app.get('/api/activity', (req, res) => { res.json(readData().activity || []); });
app.delete('/api/activity', (req, res) => { const d=readData(); d.activity=[]; writeData(d); res.json({success:true}); });

// Licenses CRUD
app.get('/api/licenses', (req, res) => res.json(readData().licenses));
app.post('/api/licenses', (req, res) => {
    const { count=1, mask, subscription, expiryValue, expiryUnit, notes, maxUses } = req.body;
    const data = readData(); const newLic = [];
    for (let i=0; i<Math.min(count,100); i++) {
        const key = generateKey(mask);
        let expiresAt = null;
        if (expiryValue && expiryUnit) { const d=new Date(); const u={minutes:'setMinutes',hours:'setHours',days:'setDate',months:'setMonth',years:'setFullYear'}; if(u[expiryUnit]){const m=u[expiryUnit];const c=m==='setDate'?d.getDate():m==='setMonth'?d.getMonth():m==='setFullYear'?d.getFullYear():d.getMinutes();d[m](c+parseInt(expiryValue));expiresAt=d.toISOString();}}
        const lic={id:genId(),key,status:'unused',banned:false,subscription:subscription||'default',notes:notes||'',maxUses:maxUses||null,useCount:0,usedIp:null,usedAt:null,createdAt:new Date().toISOString(),expiresAt};
        data.licenses.push(lic); newLic.push(lic);
    }
    logActivity(data,'licenses_created',`Created ${newLic.length} license(s)`); writeData(data);
    res.json({success:true,licenses:newLic,count:newLic.length});
});
app.put('/api/licenses/:id', (req, res) => {
    const data=readData(); const lic=data.licenses.find(l=>l.id===req.params.id||l.key===req.params.id);
    if(!lic) return res.status(404).json({success:false,message:'Not found'});
    const{notes,subscription,banned,maxUses,expiryValue,expiryUnit}=req.body;
    if(notes!==undefined)lic.notes=notes; if(subscription!==undefined)lic.subscription=subscription;
    if(banned!==undefined){lic.banned=banned;if(banned)lic.status='banned';} if(maxUses!==undefined)lic.maxUses=maxUses||null;
    if(expiryValue!==undefined&&expiryUnit){const d=new Date();const u={minutes:'setMinutes',hours:'setHours',days:'setDate',months:'setMonth',years:'setFullYear'};if(u[expiryUnit]){const m=u[expiryUnit];const c=m==='setDate'?d.getDate():m==='setMonth'?d.getMonth():m==='setFullYear'?d.getFullYear():d.getMinutes();d[m](c+parseInt(expiryValue));lic.expiresAt=d.toISOString();}}
    logActivity(data,'license_updated',lic.key); writeData(data); res.json({success:true,license:lic});
});
app.delete('/api/licenses/:id', (req, res) => {
    const data=readData(); const idx=data.licenses.findIndex(l=>l.id===req.params.id||l.key===req.params.id);
    if(idx===-1) return res.json({success:false,message:'Not found'});
    const r=data.licenses.splice(idx,1)[0]; logActivity(data,'license_deleted',r.key); writeData(data); res.json({success:true});
});
app.post('/api/licenses/:id/reset', (req, res) => {
    const data=readData(); const lic=data.licenses.find(l=>l.id===req.params.id||l.key===req.params.id);
    if(!lic) return res.json({success:false,message:'Not found'});
    lic.usedIp=null;lic.usedAt=null;lic.useCount=0;lic.status='unused';
    data.users=data.users.filter(u=>u.license!==lic.key);
    logActivity(data,'license_reset',lic.key); writeData(data); res.json({success:true});
});

// Users CRUD
app.get('/api/users', (req, res) => res.json(readData().users));
app.put('/api/users/:id', (req, res) => {
    const data=readData(); const user=data.users.find(u=>u.id===req.params.id);
    if(!user) return res.status(404).json({success:false,message:'Not found'});
    const{banned,notes,subscription,hwid}=req.body;
    if(banned!==undefined)user.banned=banned; if(notes!==undefined)user.notes=notes;
    if(subscription!==undefined)user.subscription=subscription; if(hwid!==undefined)user.hwid=hwid;
    logActivity(data,'user_updated',user.username||user.license); writeData(data); res.json({success:true,user});
});
app.delete('/api/users/:id', (req, res) => {
    const data=readData(); const idx=data.users.findIndex(u=>u.id===req.params.id);
    if(idx===-1) return res.json({success:false,message:'Not found'});
    const r=data.users.splice(idx,1)[0]; logActivity(data,'user_deleted',r.username||r.license); writeData(data); res.json({success:true});
});
app.post('/api/users/:id/resethwid', (req, res) => {
    const data=readData(); const user=data.users.find(u=>u.id===req.params.id);
    if(!user) return res.json({success:false,message:'Not found'});
    user.hwid=null; logActivity(data,'hwid_reset',user.username||user.license); writeData(data); res.json({success:true});
});

// Subscriptions
app.get('/api/subscriptions', (req, res) => res.json(readData().subscriptions));
app.post('/api/subscriptions', (req, res) => {
    const{name,duration,durationUnit,maxUsers}=req.body; if(!name) return res.status(400).json({success:false,message:'Name required'});
    const data=readData(); const sub={id:genId(),name,duration:duration||30,durationUnit:durationUnit||'days',maxUsers:maxUsers||null,createdAt:new Date().toISOString()};
    data.subscriptions.push(sub); logActivity(data,'subscription_created',name); writeData(data); res.json({success:true,subscription:sub});
});
app.delete('/api/subscriptions/:id', (req, res) => {
    const data=readData(); data.subscriptions=data.subscriptions.filter(s=>s.id!==req.params.id);
    logActivity(data,'subscription_deleted',req.params.id); writeData(data); res.json({success:true});
});

// Sessions
app.get('/api/sessions', (req, res) => res.json(readData().activeSessions || []));
app.delete('/api/sessions/:id', (req, res) => {
    const data=readData();
    if(req.params.id==='all') data.activeSessions=[];
    else data.activeSessions=(data.activeSessions||[]).filter(s=>s.id!==req.params.id);
    logActivity(data,'session_revoked',req.params.id); writeData(data); res.json({success:true});
});

// Webhooks
app.get('/api/webhooks', (req, res) => res.json(readData().webhooks));
app.post('/api/webhooks', (req, res) => {
    const{url,events}=req.body; if(!url) return res.status(400).json({success:false,message:'URL required'});
    const data=readData(); const wh={id:genId(),url,events:events||['all'],enabled:true,createdAt:new Date().toISOString()};
    data.webhooks.push(wh); logActivity(data,'webhook_created',url); writeData(data); res.json({success:true,webhook:wh});
});
app.put('/api/webhooks/:id', (req, res) => {
    const data=readData(); const wh=data.webhooks.find(w=>w.id===req.params.id);
    if(!wh) return res.status(404).json({success:false,message:'Not found'});
    if(req.body.url!==undefined)wh.url=req.body.url; if(req.body.events!==undefined)wh.events=req.body.events; if(req.body.enabled!==undefined)wh.enabled=req.body.enabled;
    writeData(data); res.json({success:true,webhook:wh});
});
app.delete('/api/webhooks/:id', (req, res) => {
    const data=readData(); data.webhooks=data.webhooks.filter(w=>w.id!==req.params.id);
    logActivity(data,'webhook_deleted',req.params.id); writeData(data); res.json({success:true});
});
app.post('/api/webhooks/:id/test', (req, res) => {
    const data=readData(); const wh=data.webhooks.find(w=>w.id===req.params.id);
    if(!wh) return res.json({success:false,message:'Not found'});
    fetch(wh.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({embeds:[{title:'UABEANext Test',description:'Webhook test successful!',color:0xEC4899}]})}).then(()=>res.json({success:true})).catch(()=>res.json({success:false,message:'Failed'}));
});

// Blacklist
app.get('/api/blacklist', (req, res) => res.json(readData().blacklist));
app.post('/api/blacklist', (req, res) => {
    const{type,value,reason}=req.body; if(!type||!value) return res.status(400).json({success:false,message:'Type and value required'});
    const data=readData(); const bl={id:genId(),type,value,reason:reason||'',createdAt:new Date().toISOString()};
    data.blacklist.push(bl); logActivity(data,'blacklist_added',`${type}: ${value}`); writeData(data); res.json({success:true,entry:bl});
});
app.delete('/api/blacklist/:id', (req, res) => {
    const data=readData(); data.blacklist=data.blacklist.filter(b=>b.id!==req.params.id);
    logActivity(data,'blacklist_removed',req.params.id); writeData(data); res.json({success:true});
});

// Files
app.get('/api/files', (req, res) => res.json(readData().files));
app.post('/api/files', (req, res) => {
    const{name,url,version,notes}=req.body; if(!name||!url) return res.status(400).json({success:false,message:'Name and URL required'});
    const data=readData(); const file={id:genId(),name,url,version:version||'1.0.0',notes:notes||'',downloads:0,createdAt:new Date().toISOString()};
    data.files.push(file); logActivity(data,'file_uploaded',name); writeData(data); res.json({success:true,file});
});
app.put('/api/files/:id', (req, res) => {
    const data=readData(); const file=data.files.find(f=>f.id===req.params.id);
    if(!file) return res.status(404).json({success:false,message:'Not found'});
    if(req.body.name!==undefined)file.name=req.body.name; if(req.body.url!==undefined)file.url=req.body.url;
    if(req.body.version!==undefined)file.version=req.body.version; if(req.body.notes!==undefined)file.notes=req.body.notes;
    writeData(data); res.json({success:true,file});
});
app.delete('/api/files/:id', (req, res) => {
    const data=readData(); data.files=data.files.filter(f=>f.id!==req.params.id);
    logActivity(data,'file_deleted',req.params.id); writeData(data); res.json({success:true});
});

// Settings
app.get('/api/settings', (req, res) => res.json(readData().settings));
app.put('/api/settings', (req, res) => {
    const data=readData(); if(!data.settings) data.settings={};
    for(const[k,v] of Object.entries(req.body)) data.settings[k]=v;
    logActivity(data,'settings_updated',''); writeData(data); res.json({success:true,settings:data.settings});
});

// Config
app.get('/api/config', (req, res) => {
    const cfg=readData().config||{};
    res.json({adminPassword:cfg.adminPassword||'admin',discordToken:cfg.discordToken||'',discordOwnerId:cfg.discordOwnerId||'',botApiAdminKey:cfg.botApiAdminKey||'',botEnabled:cfg.botEnabled||false});
});
app.put('/api/config', (req, res) => {
    const data=readData(); if(!data.config)data.config={};
    for(const[k,v] of Object.entries(req.body)) if(['adminPassword','discordToken','discordOwnerId','botApiAdminKey','botEnabled'].includes(k))data.config[k]=v;
    writeData(data); res.json({success:true});
});

// Updates
app.get('/api/update', (req, res) => res.json(readData().updates || []));
app.post('/api/update', (req, res) => {
    const{version,downloadUrl,notes}=req.body; if(!version||!downloadUrl) return res.status(400).json({success:false,message:'Required'});
    const data=readData(); if(!data.updates)data.updates=[];
    data.updates.unshift({version,downloadUrl,notes:notes||'',publishedAt:new Date().toISOString()});
    if(data.updates.length>10) data.updates=data.updates.slice(0,10); writeData(data); res.json({success:true});
});
app.delete('/api/update', (req, res) => { const d=readData(); d.updates=[]; writeData(d); res.json({success:true}); });

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
