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

if (!CONTROL_URL || !API_SECRET || !BACKEND_DIR) {
  console.error('Missing CONTROL_URL, CONTROL_API_SECRET, or BACKEND_DIR');
  process.exit(1);
}

// Map instanceId -> { child, port, meta, free, tickCount, logs, cursor, lastReportedSeconds }
const running = new Map();
// Persistent per-instance log ring buffers, kept even after the process stops.
const logBuffers = new Map();

const apiSecretHeader = { Authorization: `Bearer ${API_SECRET}` };

async function apiFetch(pathname, opts) {
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
function setupInstanceDir(id) {
  const root = instanceRoot(id);
  const serverPath = path.join(root, 'server.js');
  if (fs.existsSync(serverPath)) return root;

  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.dirname(BACKEND_DIR), { recursive: true });

  const skip = new Set([
    'node_modules',
    'logs',
    '.git',
    'admin-dist',
    'admin-panel',
    'eventlogs',
    '.env',
    '.deepseek',
    'New folder',
  ]);
  const skipFiles = ['frida_out.txt', 'frida_runner.py', 'monke_graph.py', 'CosmeticsExport.txt'];
  fs.cpSync(BACKEND_DIR, root, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const rel = path.relative(BACKEND_DIR, src);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      return !skip.has(parts[0]) && !(parts.length === 1 && skipFiles.includes(parts[0]));
    },
  });

  // Symlink the template node_modules so each instance doesn't copy hundreds of MB.
  const nmSrc = path.join(BACKEND_DIR, 'node_modules');
  const nmDst = path.join(root, 'node_modules');
  if (fs.existsSync(nmSrc) && !fs.existsSync(nmDst)) {
    try {
      fs.symlinkSync(nmSrc, nmDst, 'dir');
    } catch {
      try {
        fs.symlinkSync(nmSrc, nmDst, 'junction');
      } catch (e) {
        console.error('node_modules symlink failed for', id, e.message);
      }
    }
  }

  writeInstanceEnv(id, {});
  console.log(`[${id}] instance folder provisioned at ${root}`);
  return root;
}

// Build + write an instance .env (merged over existing). PORT/HOST are always injected
// by the spawner via process.env at boot, so .env only carries user-facing config.
function writeInstanceEnv(id, overrides) {
  const envPath = path.join(instanceRoot(id), '.env');
  const base = {
    PLAYFAB_TITLE_ID: process.env.INSTANCE_PLAYFAB_TITLE_ID || '',
    MOTHERSHIP_TITLE_ID: 'f3e9fb19',
    MOTHERSHIP_ENV_ID: '7f3a99dd-5598-4725-98cf-6538d28feb9f',
    MOTHERSHIP_DEPLOYMENT_ID: '837c4e80-a36c-49aa-bbde-18a5fa32bb3d',
    HOST: '0.0.0.0',
    DNS_REDIRECT_IP: '',
    DISCORD_LOGIN: '',
    DISCORD_ROOMS: '',
    DISCORD_WEBHOOK: '',
  };
  const merged = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      merged[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  Object.assign(merged, base, overrides || {});
  const out = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.writeFileSync(envPath, out + '\n', 'utf8');
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

  const child = spawn('node', ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '0.0.0.0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const entry = {
    child,
    port,
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
    const publicUrl = `http://${WORKER_PUBLIC_HOST}:${port}`;
    await pool.query(
      `UPDATE instances SET status = 'running', port = $2, worker_host = $3,
         public_url = $4, started_at = COALESCE(started_at, now()), last_seen_at = now()
       WHERE id = $1`,
      [work.id, port, WORKER_HOST, publicUrl]
    );
  };

  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (running.has(work.id) && child.exitCode === null) {
    await reportStarted();
    pushLog(work.id, `[worker] running at http://${WORKER_PUBLIC_HOST}:${port}`);
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
      public_url: `http://${WORKER_PUBLIC_HOST}:${entry.port}`,
    });
  }
  try {
    await apiFetch('/api/worker/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: WORKER_HOST,
        apiUrl: `http://${WORKER_PUBLIC_HOST}:${WORKER_API_PORT}`,
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

function dirListing(root, rel, maxDepth) {
  const base = safeRel(root, rel);
  const skip = new Set(['node_modules', 'logs', '.git', 'admin-dist', 'admin-panel', 'eventlogs', '.next', '.deepseek', 'New folder']);
  const skipFiles = new Set(['frida_out.txt', 'frida_runner.py', 'monke_graph.py', 'CosmeticsExport.txt']);
  function walk(dir, depth) {
    let out = [];
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory() && skipFiles.has(name)) continue;
      const relPath = path.relative(root, full).replace(/\\/g, '/');
      if (st.isDirectory()) {
        out.push({ name, path: relPath, type: 'dir' });
        if (depth < (maxDepth || 3)) out = out.concat(walk(full, depth + 1));
      } else {
        out.push({ name, path: relPath, type: 'file', size: st.size });
      }
    }
    return out;
  }
  return walk(base, 0);
}

function readFileAt(root, rel) {
  const p = safeRel(root, rel);
  const st = fs.statSync(p);
  if (st.isDirectory()) throw new Error('is a directory');
  if (st.size > FILE_READ_MAX) throw new Error('file too large to view');
  return { content: fs.readFileSync(p, 'utf8'), size: st.size };
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
      const entries = dirListing(root, url.searchParams.get('path') || '/', 3);
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
    if (!m) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    handleDaemonRequest(req, res, url, m[1]).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
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