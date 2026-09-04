import { NextResponse } from 'next/server';
import db from '../../../../../lib/db';
const { query } = db;
import { getCurrentUser } from '../../../../../lib/auth';
import { callWorker } from '../../../../../lib/worker-client';

export const runtime = 'nodejs';

// POST /api/instances/[id]/restart — bounce the container on the worker.
export async function POST(req, { params }) {
  const user = await getCurrentUser(req, { query });
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const { rows } = await query('SELECT id FROM instances WHERE id = $1 AND owner_id = $2', [
    id,
    user.id,
  ]);
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    const data = await callWorker(db, id, '/restart', { method: 'POST', body: '{}' });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}