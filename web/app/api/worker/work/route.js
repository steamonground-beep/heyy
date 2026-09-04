import { NextResponse } from 'next/server';
import db from '../../../../lib/db';
const { query } = db;
import { authorizeWorker } from '../../../../lib/worker-auth';

export const runtime = 'nodejs';

// Worker polls this to fetch instances it should (re)start ('starting') and
// instances that should be terminated ('stopping').
export async function GET(req) {
  const auth = req.headers.get('authorization') || '';
  const worker = await authorizeWorker(auth);
  if (!worker) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [{ rows: work }, { rows: stopping }] = await Promise.all([
    query(
      `SELECT i.id, i.name, i.owner_id, u.discord_id, u.tier, i.config
       FROM instances i
       JOIN users u ON u.id = i.owner_id
       WHERE i.status = 'starting'`
    ),
    query(`SELECT id FROM instances WHERE status = 'stopping'`),
  ]);

  return NextResponse.json({ work, stopping });
}