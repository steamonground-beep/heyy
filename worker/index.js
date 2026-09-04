require('dotenv').config();
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
const BACKEND_DIR = process.env.BACKEND_DIR; // path to the game backend source
const START_PORT = Number(process.env.START_PORT || 3800);
const MAX_INSTANCES = Number(process.env.MAX_INSTANCES || 20);
const TICK_SECONDS = 60; // report usage every 60s
const POLL_MS = 10000;
// Publicly reachable hostname/IP of this node (used in connection URLs shown to users).
const WORKER_PUBLIC_HOST = process.env.WORKER_PUBLIC_HOST || process.env.WORKER_HOST || '127.0.0.1';

if (!CONTROL_URL || !API_SECRET || !BACKEND_DIR) {
  console.error('Missing CONTROL_URL, CONTROL_API_SECRET, or BACKEND_DIR');
  process.exit(1);
}

// Map instanceId -> { child, port, meta, free, tickCount, lastReportedSeconds }
const running = new Map();

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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nextPort(base) {
  // Find an unused port starting at START_PORT.
  for (let p = START_PORT; p < START_PORT + 2000; p++) {
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

// Mark instance as stopped/error and clean up process.
async function stopInstance(instanceId, status = 'stopped') {
  const entry = running.get(instanceId);
  if (entry) {
    try {
      entry.child.kill('SIGTERM');
    } catch {}
    running.delete(instanceId);
  }
  await pool.query('UPDATE instances SET status = $2 WHERE id = $1', [instanceId, status]);
}

// Spawn a backend process for a starting work item.
async function startWorkItem(work) {
  if (running.size >= MAX_INSTANCES) {
    console.error('At instance limit; cannot start', work.id);
    await pool.query('UPDATE instances SET status = $2 WHERE id = $1', [work.id, 'error']);
    return;
  }
  const port = nextPort(START_PORT);

  // Build env for the child backend process. We set PORT so the backend
  // listens on the assigned port. Users' package.json start is `node server.js`.
  const child = spawn('node', ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  running.set(work.id, {
    child,
    port,
    meta: work,
    free: work.tier === 'free',
    tickCount: 0,
    procLine: 0,
  });

  child.stdout.on('data', (d) => {
    const entry = running.get(work.id);
    if (!entry) return;
    if (entry.procLine < 200) {
      process.stdout.write(`[${work.id}] ${d}`);
      entry.procLine++;
    }
  });
  child.stderr.on('data', (d) => {
    const entry = running.get(work.id);
    if (!entry) return;
    if (entry.procLine < 200) {
      process.stderr.write(`[${work.id}] ${d}`);
      entry.procLine++;
    }
  });

  const reportStarted = async () => {
    await pool.query(
      `UPDATE instances SET status = 'running', port = $2, worker_host = $3,
         public_url = $4, started_at = now()
       WHERE id = $1`,
      [work.id, port, process.env.WORKER_HOST || 'default', `http://${WORKER_PUBLIC_HOST}:${port}`]
    );
  };

  // The backend may need a moment to bind; give it a short grace period, then
  // mark it running. If it exited quickly, mark error instead.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (running.has(work.id) && child.exitCode === null) {
    await reportStarted();
    console.log(`[${work.id}] running on port ${port}`);
  } else {
    if (running.get(work.id)) running.delete(work.id);
    await pool.query(`UPDATE instances SET status = 'error' WHERE id = $1`, [work.id]);
  }

  // Register live child handlers for later crashes.
  child.on('exit', (code, signal) => {
    const entry = running.get(work.id);
    if (!entry) return;
    console.log(`[${work.id}] exited code=${code} signal=${signal}`);
    running.delete(work.id);
    // Only mark error if it wasn't intentionally stopped.
    const status = code === 0 ? 'stopped' : 'error';
    pool.query('UPDATE instances SET status = $2 WHERE id = $1 AND status != $2', [
      work.id,
      status,
    ]);
  });
}

// Enforce free-tier runtime cap: kill free instances whose total runtime
// exceeds the setting (7h default). Check the reported cumulative seconds
// from the DB plus this worker's in-memory increments.
async function enforceFreeLimits() {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE key = 'free_tier'`
  );
  const freeCfg = rows.length
    ? rows[0].value
    : { max_instances: 1, max_run_hours: 7 };
  const maxHours = freeCfg.max_run_hours;
  if (maxHours == null) return;

  const maxSeconds = maxHours * 3600;
  for (const [id, entry] of running.entries()) {
    if (!entry.free) continue;
    const total = await dbRealTime(id);
    if (total >= maxSeconds) {
      console.log(`[${id}] free tier cap (${maxHours}h) reached; stopping`);
      await stopInstance(id, 'stopped');
      entry.child.kill('SIGTERM').catch(() => {});
      running.delete(id);
      pool
        .query('UPDATE instances SET status = $2 WHERE id = $1', [id, 'stopped'])
        .catch(() => {});
    }
  }
}

// Report usage tick for each running instance every TICK_SECONDS.
async function reportTicks() {
  for (const [id, entry] of running.entries()) {
    const { rows } = await pool.query(
      `SELECT status FROM instances WHERE id = $1`,
      [id]
    );
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
  }
}

// Heartbeat: report currently-running summary so web shows live status.
async function heartbeat() {
  const instances = [];
  for (const [id, entry] of running.entries()) {
    instances.push({
      id,
      status: entry.child.exitCode === null ? 'running' : 'stopped',
      port: entry.port,
      public_url: entry.port ? `http://${WORKER_PUBLIC_HOST}:${entry.port}` : null,
    });
  }
  try {
    await apiFetch('/api/worker/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: process.env.WORKER_HOST || 'default', instances }),
    });
  } catch (e) {
    console.error('heartbeat failed:', e.message);
  }
}

// Poll for new work (instances in 'starting' state).
async function pollWork() {
  try {
    const { work } = await apiFetch('/api/worker/work');
    for (const w of work) {
      if (!running.has(w.id)) {
        await startWorkItem(w);
      }
    }
  } catch (e) {
    console.error('work poll failed:', e.message);
  }
}

async function mainLoop() {
  await pollWork();
  await enforceFreeLimits();
  await reportTicks();
  await heartbeat();
}

async function main() {
  console.log('Worker started');
  console.log('  control:', CONTROL_URL);
  console.log('  backend dir:', BACKEND_DIR);
  console.log('  start port:', START_PORT);
  console.log('  max instances:', MAX_INSTANCES);
  await mainLoop();
  setInterval(mainLoop, POLL_MS);
}

// Clean shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  for (const [id, entry] of running.entries()) {
    try {
      await stopInstance(id, 'stopped');
    } catch {}
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  for (const [id, entry] of running.entries()) {
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