require('dotenv').config();
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL === 'true' || /sslmode=require/.test(process.env.DATABASE_URL || '')
      ? { rejectUnauthorized: false }
      : undefined,
});

// Configuration
const CONTROL_URL = process.env.CONTROL_URL;
const API_SECRET = process.env.CONTROL_API_SECRET;
const BACKEND_DIR = process.env.BACKEND_DIR; // template backend source (server.js inside)
const INSTANCES_DIR = process.env.INSTANCES_DIR || path.join(BACKEND_DIR, '..', 'instances');
const START_PORT = Number(process.env.START_PORT || 3800);
const MAX_INSTANCES = Number(process.env.MAX_INSTANCES || 20);
const WORKER_API_PORT = Number(process.env.WORKER_API_PORT || 4770);
const TICK_SECONDS = 60;
const POLL_MS = 10000;
const LOG_LIMIT = 2000;
const FILE_READ_MAX = 1024 * 1024; // 1MB cap for reads
const WORKER_HOST = process.env.WORKER_HOST || 'default';
const WORKER_PUBLIC_HOST = process.env.WORKER_PUBLIC_HOST || '127.0.0.1';
// When set (e.g. rayvo.me), each instance is publicly reachable at
// https://<instanceId>.<WORKER_PUBLIC_DOMAIN> — a wildcard reverse proxy
// (startWildcardProxy) routes those hostnames to the instance's port.
const WORKER_PUBLIC_DOMAIN = process.env.WORKER_PUBLIC_DOMAIN || '';
// Port the wildcard reverse proxy listens on (games hit this hostname).
const WORKER_PROXY_PORT = Number(process.env.WORKER_PROXY_PORT || 4771);

if (!CONTROL_URL || !API_SECRET || !BACKEND_DIR) {
  console.error('Missing CONTROL_URL, CONTROL_API_SECRET, or BACKEND_DIR');
  process.exit(1);
}

// Map instanceId -> { child, port, meta, free, tickCount, logs, cursor, lastReportedSeconds }
const running = new Map();
// Persistent per-instance log ring buffers, kept even after the process stops.
const logBuffers = new Map();

const apiSecretHeader = { Authorization: `Bearer ${API_SECRET}` };

async function apiFetch(pathname, opts = {}) {
  const res = await fetch(`${CONTROL_URL}${pathname}`, {
    ...opts,
    headers: { ...apiSecretHeader, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${pathname} -> ${res.status}: ${text}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function instanceRoot(id) {
  return path.join(INSTANCES_DIR, id);
}

// Copy the template backend into this instance's own folder (isolated per user).
// Skips node_modules (symlinked), logs, .git, and replaces .env with a blank-safe one.
// Recursively copy template files/dirs into dst only when the target is missing.
function cpMissing(srcDir, dstDir) {
  const skip = new Set(['node_modules', 'logs', 'eventlogs', '.git', '.deepseek', '.env',
    'admin-panel', 'New folder']);
  const skipFiles = new Set(['frida_out.txt', 'frida_runner.py', 'monke_graph.py', 'CosmeticsExport.txt']);
  const skipName = (name) =>
    skip.has(name) ||
    skipFiles.has(name) ||
    /(^|\s)- Copy/.test(name) ||
    /\.bak$/i.test(name);
  let names;
  try {
    names = fs.readdirSync(srcDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (skipName(name)) continue;
    const s = path.join(srcDir, name);
    const d = path.join(dstDir, name);
    let st;
    try {
      st = fs.statSync(s);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      cpMissing(s, d);
    } else if (!fs.existsSync(d)) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

function setupInstanceDir(id) {
  const root = instanceRoot(id);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.dirname(BACKEND_DIR), { recursive: true });
  if (!fs.existsSync(BACKEND_DIR)) throw new Error(`backend template missing: ${BACKEND_DIR}`);

  // Top-up copy: bring in any template files/folders the instance lacks, without
  // clobbering existing files (so older thin copies get the full tree too).
  cpMissing(BACKEND_DIR, root);

  // Symlink the template node_modules so each instance doesn't copy hundreds of MB.
  // On Windows prefer a junction (no admin rights needed).
  const nmSrc = path.join(BACKEND_DIR, 'node_modules');
  const nmDst = path.join(root, 'node_modules');
  if (fs.existsSync(nmSrc) && !fs.existsSync(nmDst)) {
    let linked = false;
    const types = process.platform === 'win32' ? ['junction', 'dir'] : ['dir', 'junction'];
    for (const t of types) {
      try {
        fs.symlinkSync(nmSrc, nmDst, t);
        linked = true;
        console.log(`[${id}] linked node_modules (${t})`);
        break;
      } catch (e) {
        console.log(`[${id}] node_modules ${t} link failed: ${e.message}`);
      }
    }
    if (!linked) console.error(`[${id}] node_modules link FAILED — instance may not boot`);
  }

  // Seed the instance .env from the template's full config the first time.
  const templateEnv = path.join(BACKEND_DIR, '.env');
  const envPath = path.join(root, '.env');
  if (fs.existsSync(templateEnv) && !fs.existsSync(envPath)) {
    fs.copyFileSync(templateEnv, envPath);
    console.log(`[${id}] seeded .env from template`);
  }

  writeInstanceEnv(id, {});
  console.log(`[${id}] instance folder provisioned at ${root}`);
  return root;
}

// Build + write an instance .env. Preserves the file's comments/blanks verbatim and
// only adjusts k=v lines (or appends) for keys that are missing, so a seeded full
// template .env stays byte-identical. PORT is injected by the spawner at boot.
function writeInstanceEnv(id, overrides) {
  const envPath = path.join(instanceRoot(id), '.env');
  const base = {
    PLAYFAB_TITLE_ID: process.env.INSTANCE_PLAYFAB_TITLE_ID || '',
    MOTHERSHIP_TITLE_ID: 'f3e9fb19',
    MOTHERSHIP_ENV_ID: '7f3a99dd-5598-4725-98cf-6538d28feb9f',
    MOTHERSHIP_DEPLOYMENT_ID: '837c4e80-a36c-49aa-bbde-18a5fa32bb3d',
    HOST: '0.0.0.0',
    DNS_REDIRECT_IP: '',
  };
  const merged = {};
  const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : [];
  for (const line of original) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    merged[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  for (const [k, v] of Object.entries(base)) {
    if (merged[k] === undefined) merged[k] = v;
  }
  Object.assign(merged, overrides || {});
  const out = [];
  const written = new Set();
  for (const line of original) {
    if (/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.test(line)) {
      const k = line.trim().split('=')[0].trim();
      if (merged[k] !== undefined) {
        out.push(`${k}=${merged[k]}`);
        written.add(k);
        continue;
      }
    }
    out.push(line);
  }
  for (const [k, v] of Object.entries(merged)) {
    if (!written.has(k)) out.push(`${k}=${v}`);
  }
  fs.writeFileSync(envPath, out.join('\n'), 'utf8');
}

function nextPort(base) {
  for (let p = base; p < base + 2000; p++) {
    let inUse = false;
    for (const entry of running.values()) {
      if (entry.port === p) {
        inUse = true;
        break;
      }
    }
    if (!inUse) return p;
  }
  throw new Error('No free port');
}

async function dbRealTime(instanceId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(run_seconds, 0) AS s FROM instance_runtime WHERE instance_id = $1',
    [instanceId]
  );
  return rows.length ? Number(rows[0].s) : 0;
}

function pushLog(id, text) {
  let buf = logBuffers.get(id);
  if (!buf) {
    buf = { lines: [], cursor: 0 };
    logBuffers.set(id, buf);
  }
  const ts = new Date().toISOString();
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    buf.lines.push({ n: ++buf.cursor, t: ts, s: line });
  }
  if (buf.lines.length > LOG_LIMIT) buf.lines = buf.lines.slice(-LOG_LIMIT);
}

async function stopInstance(instanceId, status = 'stopped') {
  const entry = running.get(instanceId);
  if (entry) {
    try {
      entry.child.kill('SIGTERM');
    } catch {}
    running.delete(instanceId);
    pushLog(instanceId, `[worker] process terminated (${status})`);
  }
  await pool.query('UPDATE instances SET status = $2, last_seen_at = now() WHERE id = $1', [
    instanceId,
    status,
  ]);
}

async function startProcess(work) {
  const root = setupInstanceDir(work.id);
  if (running.size >= MAX_INSTANCES) {
    console.error('At instance limit; cannot start', work.id);
    await pool.query('UPDATE instances SET status = $2 WHERE id = $1', [work.id, 'error']);
    return;
  }
  const port = nextPort(START_PORT);
  // Get the owner info for the instance to build the path-based URL
  const { rows: ownerRows } = await pool.query(
    'SELECT u.discord_username FROM instances i JOIN users u ON i.owner_id = u.id WHERE i.id = $1',
    [work.id]
  );
  const username = ownerRows.length ? ownerRows[0].discord_username : 'unknown';
  
  // Public URL announced for this instance: path-based URL under the public host.
  const publicBase = process.env.WORKER_PUBLIC_URL || process.env.WORKER_DAEMON_URL || 'https://rayvo.me';
  const publicUrl = `${publicBase.replace(/\/+$/, '')}/play/${username}/${work.id}`;
  const workEnv = {
    ...process.env,
    PORT: String(port),
    HOST: '0.0.0.0',
    PUBLIC_URL: publicUrl,
  };
  const child = spawn('node', ['server.js'], {
    cwd: root,
    env: workEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const entry = {
    child,
    port,
    publicUrl,
    meta: work,
    free: work.tier === 'free',
    tickCount: 0,
    lastReportedSeconds: 0,
  };
  running.set(work.id, entry);

  child.stdout.on('data', (d) => pushLog(work.id, d.toString()));
  child.stderr.on('data', (d) => pushLog(work.id, d.toString()));
  pushLog(work.id, `[worker] starting instance ${work.id} on port ${port}`);

  const reportStarted = async () => {
    await pool.query(
      `UPDATE instances SET status = 'running', port = $2, worker_host = $3,
         public_url = $4, started_at = COALESCE(started_at, now()), last_seen_at = now()
        WHERE id = $1`,
      [work.id, port, WORKER_HOST, publicUrl]
    );
    console.log(`[${work.id}] public URL set to ${publicUrl}`);
    console.log(`[${work.id}] API endpoint: ${publicUrl}/api`);
    console.log(`[${work.id}] WebSocket endpoint: ${publicUrl.replace(/^https:/, 'wss:')}/ws/prod-GT-ws-stage/`);
  };

  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (running.has(work.id) && child.exitCode === null) {
    await reportStarted();
    pushLog(work.id, `[worker] running at ${publicUrl}`);
    console.log(`[${work.id}] running on port ${port}`);
  } else {
    if (running.get(work.id)) running.delete(work.id);
    await pool.query(`UPDATE instances SET status = 'error' WHERE id = $1`, [work.id]);
  }

  child.on('exit', (code, signal) => {
    const e = running.get(work.id);
    if (!e) return;
    console.log(`[${work.id}] exited code=${code} signal=${signal}`);
    running.delete(work.id);
    pushLog(work.id, `[worker] process exited code=${code} signal=${signal || 'none'}`);
    const status = code === 0 ? 'stopped' : 'error';
    pool.query('UPDATE instances SET status = $2, last_seen_at = now() WHERE id = $1', [
      work.id,
      status,
    ]);
  });
}

async function startWorkItem(work) {
  if (!work || work.status === 'stopping') return;
  if (running.has(work.id)) return;
  try {
    await startProcess(work);
  } catch (e) {
    console.error(`start failed for ${work.id}:`, e.message);
    await pool.query('UPDATE instances SET status = $2 WHERE id = $1', [work.id, 'error']).catch(() => {});
  }
}

// Kill instances that the web marked 'stopping'.
async function processStopping() {
  const { rows } = await pool.query("SELECT id FROM instances WHERE status = 'stopping'");
  for (const r of rows) {
    await stopInstance(r.id, 'stopped');
  }
}

// Enforce free-tier runtime cap (same as before).
async function enforceFreeLimits() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'free_tier'`);
  const freeCfg = rows.length ? rows[0].value : { max_instances: 1, max_run_hours: 7 };
  const maxHours = freeCfg.max_run_hours;
  if (maxHours == null) return;
  const maxSeconds = maxHours * 3600;
  for (const [id, entry] of running.entries()) {
    if (!entry.free) continue;
    const total = await dbRealTime(id);
    if (total >= maxSeconds) {
      console.log(`[${id}] free tier cap (${maxHours}h) reached; stopping`);
      await stopInstance(id, 'stopped');
    }
  }
}

async function reportTicks() {
  for (const [id, entry] of running.entries()) {
    try {
      const { rows } = await pool.query(`SELECT status FROM instances WHERE id = $1`, [id]);
      if (!rows.length) {
        running.delete(id);
        try {
          entry.child.kill('SIGTERM');
        } catch {}
        continue;
      }
      if (rows[0].status !== 'running') continue;
      try {
        await apiFetch('/api/worker/tick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId: id, seconds: TICK_SECONDS }),
        });
      } catch (e) {
        console.error(`tick failed for ${id}:`, e.message);
      }
    } catch (e) {
      console.error(`reportTicks ${id} failed:`, e.message);
    }
  }
}

async function heartbeat() {
  const instances = [];
  for (const [id, entry] of running.entries()) {
    instances.push({
      id,
      status: entry.child.exitCode === null ? 'running' : 'stopped',
      port: entry.port,
      public_url: entry.publicUrl || `http://${WORKER_PUBLIC_HOST}:${entry.port}`,
    });
  }
  try {
    await apiFetch('/api/worker/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: WORKER_HOST,
        apiUrl: process.env.WORKER_DAEMON_URL || `http://${WORKER_PUBLIC_HOST}:${WORKER_API_PORT}`,
        instances,
      }),
    });
  } catch (e) {
    console.error('heartbeat failed:', e.message);
  }
}

async function pollWork() {
  try {
    const { work } = await apiFetch('/api/worker/work');
    for (const w of work || []) await startWorkItem(w);
  } catch (e) {
    console.error('work poll failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Inbound daemon API (file manager, settings, logs, restart) served on the VPS.
// Authenticated with the shared CONTROL_API_SECRET bearer token.
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function isAuthed(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(String(API_SECRET || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function safeRel(root, rel) {
  const clean = String(rel || '/').replace(/\\/g, '/').replace(/^\/+/, '');
  const p = path.resolve(root, clean);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('invalid path');
  return p;
}

function dirListing(root, rel) {
  const base = safeRel(root, rel);
  const out = [];
  for (const name of fs.readdirSync(base)) {
    const full = path.join(base, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    const relPath = path.relative(root, full).replace(/\\/g, '/');
    out.push(
      st.isDirectory()
        ? { name, path: relPath, type: 'dir' }
        : { name, path: relPath, type: 'file', size: st.size }
    );
  }
  return out;
}

function readFileAt(root, rel) {
  const p = safeRel(root, rel);
  const st = fs.statSync(p);
  if (st.isDirectory()) throw new Error('is a directory');
  if (st.size > FILE_READ_MAX) throw new Error('file too large to view');
  return { content: fs.readFileSync(p, 'utf8'), size: st.size };
}

async function getPublicInstance(instanceId) {
  const { rows } = await pool.query(
    `SELECT i.id, i.port, i.status, u.discord_username AS username
     FROM instances i
     JOIN users u ON u.id = i.owner_id
     WHERE i.id = $1`,
    [instanceId]
  );
  return rows[0] || null;
}

function addCors(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return headers;
}

function targetPathFromPublicRoute(urlPathname, username, instanceId) {
  const prefixes = [
    `/play/${username}/${instanceId}`,
    `/api/${username}/${instanceId}`,
    `/ws/${username}/${instanceId}`,
  ];
  for (const prefix of prefixes) {
    if (urlPathname === prefix) return '/';
    if (urlPathname.startsWith(prefix + '/')) {
      let rest = urlPathname.slice(prefix.length);
      // Client WS URLs use /ws/<something>; the backend serves <something> directly
      // (e.g. /ws/prod-GT-ws-stage/ -> /prod-GT-ws-stage/).
      if (rest.startsWith('/ws/')) rest = rest.slice(3) || '/';
      return rest;
    }
  }
  return null;
}

function proxyHttpToPort(req, res, targetPort, targetPath, originalUrl) {
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      method: req.method,
      path: `${targetPath}${originalUrl.search || ''}`,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${targetPort}`,
      },
    },
    (proxyRes) => {
      const headers = addCors(new Headers());
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value == null) continue;
        if (key.toLowerCase() === 'host') continue;
        if (Array.isArray(value)) headers.set(key, value.join(', '));
        else headers.set(key, String(value));
      }
      res.writeHead(proxyRes.statusCode || 502, Object.fromEntries(headers.entries()));
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (e) => {
    try { res.writeHead(502, { 'Content-Type': 'application/json' }); } catch {}
    try { res.end(JSON.stringify({ error: e.message || 'proxy failed' })); } catch {}
  });
  req.pipe(proxyReq);
}

function proxyUpgradeToPort(req, socket, head, targetPort, targetPath, originalUrl) {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: targetPort,
    method: 'GET',
    path: `${targetPath}${originalUrl.search || ''}`,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${targetPort}`,
      connection: 'Upgrade',
      upgrade: req.headers.upgrade || 'websocket',
    },
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    let response = `HTTP/1.1 ${proxyRes.statusCode || 101} ${proxyRes.statusMessage || 'Switching Protocols'}\r\n`;
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (value == null) continue;
      response += `${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`;
    }
    response += '\r\n';
    socket.write(response);
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    if (head && head.length) proxySocket.write(head);
    proxySocket.pipe(socket).pipe(proxySocket);
  });

  proxyReq.on('error', () => {
    try { socket.destroy(); } catch {}
  });

  proxyReq.end();
}

async function handlePublicRequest(req, res, url, username, instanceId) {
  const targetPath = targetPathFromPublicRoute(url.pathname, username, instanceId);
  if (!targetPath) return false;

  const instance = await getPublicInstance(instanceId);
  if (!instance) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'instance not found' }));
    return true;
  }
  if (instance.status !== 'running') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'instance not running' }));
    return true;
  }

  proxyHttpToPort(req, res, instance.port, targetPath, url);
  return true;
}

async function handlePublicUpgrade(req, socket, head, url, username, instanceId) {
  const targetPath = targetPathFromPublicRoute(url.pathname, username, instanceId);
  if (!targetPath) return false;

  const instance = await getPublicInstance(instanceId);
  if (!instance || instance.status !== 'running') {
    socket.destroy();
    return true;
  }

  proxyUpgradeToPort(req, socket, head, instance.port, targetPath, url);
  return true;
}

async function handleDaemonRequest(req, res, url, instanceId) {
  if (!isAuthed(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  // Strip the /api/instance/<id> prefix so inner routes are just /files,/file,etc.
  const route = url.pathname.replace(/^\/api\/instance\/[^/]+/, '');

  const root = instanceRoot(instanceId);
  if (!fs.existsSync(root)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'instance not provisioned' }));
    return;
  }

  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  try {
    if (req.method === 'GET' && route === '/files') {
      const entries = dirListing(root, url.searchParams.get('path') || '/');
      return json(200, { entries });
    }

    if (req.method === 'GET' && route === '/file') {
      const { content, size } = readFileAt(root, url.searchParams.get('path') || '');
      return json(200, { content, size });
    }

    if (req.method === 'POST' && route === '/file') {
      const body = await readBody(req);
      const rel = String(body.path || '');
      const p = safeRel(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(body.content ?? ''), 'utf8');
      return json(200, { ok: true });
    }

    if (req.method === 'GET' && route === '/logs') {
      const after = Number(url.searchParams.get('after') || 0);
      const buf = logBuffers.get(instanceId);
      const lines = buf ? buf.lines.filter((l) => l.n > after) : [];
      const runningNow = running.has(instanceId);
      return json(200, { lines, cursor: buf ? buf.cursor : 0, running: runningNow });
    }

    if (req.method === 'POST' && route === '/restart') {
      const entry = running.get(instanceId);
      if (!entry) {
        await startProcess((await pool.query('SELECT * FROM instances WHERE id = $1', [instanceId])).rows[0]);
      } else {
        pushLog(instanceId, '[worker] restart requested; stopping process');
        try {
          entry.child.kill('SIGTERM');
        } catch {}
        running.delete(instanceId);
        await pool.query("UPDATE instances SET status = 'starting', last_seen_at = now() WHERE id = $1", [instanceId]);
        // Wait for exit handler bookkeeping, then spawn fresh.
        await sleep(250);
        const { rows } = await pool.query('SELECT * FROM instances WHERE id = $1', [instanceId]);
        await startProcess(rows[0]);
      }
      return json(200, { ok: true });
    }

    if (req.method === 'POST' && route === '/stop') {
      await stopInstance(instanceId, 'stopped');
      return json(200, { ok: true });
    }
  } catch (e) {
    return json(400, { error: e.message });
  }

  json(404, { error: 'not found' });
}

function startDaemonServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${WORKER_API_PORT}`);
    const m = url.pathname.match(/^\/api\/instance\/([^/]+)\/(files|file|logs|restart|stop)$/);
    if (m) {
      handleDaemonRequest(req, res, url, m[1]).catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    const publicMatch = url.pathname.match(/^\/(?:play|api|ws)\/([^/]+)\/([^/]+)(?:\/.*)?$/);
    if (publicMatch) {
      handlePublicRequest(req, res, url, publicMatch[1], publicMatch[2]).catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://localhost:${WORKER_API_PORT}`);
    const publicMatch = url.pathname.match(/^\/(?:play|api|ws)\/([^/]+)\/([^/]+)(?:\/.*)?$/);
    if (!publicMatch) {
      socket.destroy();
      return;
    }
    handlePublicUpgrade(req, socket, head, url, publicMatch[1], publicMatch[2]).catch(() => {
      try { socket.destroy(); } catch {}
    });
  });
  server.listen(WORKER_API_PORT, '0.0.0.0', () => {
    console.log(`Daemon API listening on :${WORKER_API_PORT}`);
  });
}

async function mainLoop() {
  await pollWork();
  try {
    await processStopping();
  } catch (e) {
    console.error('stopping pass failed:', e.message);
  }
  try {
    await enforceFreeLimits();
  } catch (e) {
    console.error('free-limit pass failed:', e.message);
  }
  await reportTicks();
  try {
    await heartbeat();
  } catch (e) {
    console.error('heartbeat failed:', e.message);
  }
}

async function main() {
  console.log('Worker started');
  console.log('  control:', CONTROL_URL);
  console.log('  template dir:', BACKEND_DIR);
  console.log('  instances dir:', INSTANCES_DIR);
  console.log('  start port:', START_PORT);
  console.log('  daemon port:', WORKER_API_PORT);
  console.log('  max instances:', MAX_INSTANCES);
  fs.mkdirSync(INSTANCES_DIR, { recursive: true });
  startDaemonServer();
  await mainLoop();
  setInterval(mainLoop, POLL_MS);
}

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  for (const [id] of running.entries()) {
    try {
      await stopInstance(id, 'stopped');
    } catch {}
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  for (const [id] of running.entries()) {
    try {
      await stopInstance(id, 'stopped');
    } catch {}
  }
  process.exit(0);
});

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
