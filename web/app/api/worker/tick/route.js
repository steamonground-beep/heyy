import { NextResponse } from 'next/server';
import db from 'shared/db';
const { query } = db;
import { authorizeWorker } from 'shared/auth';

export const runtime = 'nodejs';

// The worker polls this to fetch instances it should (re)start:
// any instance in 'starting' state.
export async function GET(req) {
  const auth = req.headers.get('authorization') || '';
  const worker = await authorizeWorker(auth);
  if (!worker) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { rows } = await query(
    `SELECT i.id, i.name, i.owner_id, u.discord_id, u.tier, i.config
     FROM instances i
     JOIN users u ON u.id = i.owner_id
     WHERE i.status = 'starting'`
  );
  return NextResponse.json({ work: rows });
}

// The worker reports a usage tick for an instance: seconds it was running.
export async function POST(req) {
  const auth = req.headers.get('authorization') || '';
  const worker = await authorizeWorker(auth);
  if (!worker) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { instanceId, seconds } = body;
  if (!instanceId || typeof seconds !== 'number' || seconds <= 0) {
    return NextResponse.json({ error: 'instanceId and positive seconds required' }, { status: 400 });
  }

  await query(
    'INSERT INTO usage_ticks (instance_id, seconds) VALUES ($1, $2)',
    [instanceId, seconds]
  );
  await query(
    'UPDATE instance_runtime SET run_seconds = run_seconds + $2, updated_at = now() WHERE instance_id = $1',
    [instanceId, seconds]
  );
  return NextResponse.json({ ok: true });
}