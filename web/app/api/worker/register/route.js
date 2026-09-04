import { NextResponse } from 'next/server';
import db from '../../../../lib/db';
const { query } = db;
import { authorizeWorker } from '../../../../lib/worker-auth';

export const runtime = 'nodejs';

// Worker heartbeat. The worker POSTs a summary of which instances it's running
// so the web app can show live status without the worker connecting inbound.
export async function POST(req) {
  const auth = req.headers.get('authorization') || '';
  const worker = await authorizeWorker(auth);
  if (!worker) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const host = body.host || 'unknown';
  const instances = body.instances; // array of { id, status, port?, pid?, public_url? }
  if (!Array.isArray(instances)) {
    return NextResponse.json({ error: 'instances required' }, { status: 400 });
  }

  const now = new Date();

  // Update worker last_seen.
  if (worker.id && worker.id !== 'verified-worker') {
    await query('UPDATE workers SET last_seen = $1 WHERE id = $2', [now, worker.id]);
  }

  // Update each reported instance + mark others on this host as not-seen is left to worker.
  for (const inst of instances) {
    await query(
      `UPDATE instances SET
         status = $2,
         port = COALESCE($3, port),
         public_url = COALESCE($4, public_url),
         worker_host = $5,
         last_seen_at = now(),
         started_at = CASE WHEN $2 = 'running' AND started_at IS NULL THEN now() ELSE started_at END
       WHERE id = $1`,
      [inst.id, inst.status || 'running', inst.port ?? null, inst.public_url ?? null, host]
    );
  }

  return NextResponse.json({ ok: true });
}