import { NextResponse } from 'next/server';
import db from '../../../../../lib/db';
const { query } = db;
import { getCurrentUser } from '../../../../../lib/auth';
import { callWorker } from '../../../../../lib/worker-client';

export const runtime = 'nodejs';

// GET /api/instances/[id]/logs?after=N — stream-style polling log tail.
export async function GET(req, { params }) {
  const user = await getCurrentUser(req, { query });
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const { rows } = await query('SELECT id FROM instances WHERE id = $1 AND owner_id = $2', [
    id,
    user.id,
  ]);
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const after = Number(new URL(req.url).searchParams.get('after') || 0);
  try {
    const data = await callWorker(db, id, `/logs?after=${after}`, { method: 'GET' });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}