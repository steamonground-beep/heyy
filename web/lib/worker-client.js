// Client used by Vercel API routes to call back into the worker daemon API.
const NAV = '/api/instance';
let cached = null;
let cacheAt = 0;

const apiSecretHeader = { Authorization: `Bearer ${process.env.CONTROL_API_SECRET}` };

export async function workerApiUrl(db) {
  const { rows } = await db.query(
    `SELECT value FROM settings WHERE key = 'worker_api'`
  );
  if (rows.length) {
    const parsed = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    return parsed.url || null;
  }
  if (process.env.WORKER_API_URL && !cached) {
    cached = process.env.WORKER_API_URL;
  }
  const fresh = Date.now() - cacheAt < 60000;
  if (cached && fresh) return cached;
  return cached || null;
}

export async function callWorker(db, instanceId, path, init) {
  const base = await workerApiUrl(db);
  if (!base) {
    const err = new Error('WORKER_API_URL is not configured');
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${base}${NAV}/${instanceId}${path}`, {
    ...init,
    headers: {
      ...apiSecretHeader,
      'ngrok-skip-browser-warning': '1',
      ...((init && init.headers) || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || `worker returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}