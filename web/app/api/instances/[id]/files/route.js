import { NextResponse } from 'next/server';
import db from '../../../../../lib/db';
const { query } = db;
import { getCurrentUser } from '../../../../../lib/auth';
import { callWorker } from '../../../../../lib/worker-client';

export const runtime = 'nodejs';

async function getOwnedInstance(instanceId, userId) {
  const { rows } = await query('SELECT * FROM instances WHERE id = $1 AND owner_id = $2', [
    instanceId,
    userId,
  ]);
  return rows.length ? rows[0] : null;
}

// List directory / read file. Query: ?path=server.js
export async function GET(req, { params }) {
  const user = await getCurrentUser(req, { query });
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const inst = await getOwnedInstance(id, user.id);
  if (!inst) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const searchParams = new URL(req.url).searchParams;
  const rel = searchParams.get('path') || '/';

  // `view=1` reads file contents; otherwise returns the directory listing.
  const wantFile = searchParams.get('view') === '1';
  try {
    const data = wantFile
      ? await callWorker(db, id, `/file?path=${encodeURIComponent(rel)}`, { method: 'GET' })
      : await callWorker(db, id, `/files?path=${encodeURIComponent(rel)}`, { method: 'GET' });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}

// Write a file. Body: { path, content }
export async function POST(req, { params }) {
  const user = await getCurrentUser(req, { query });
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const inst = await getOwnedInstance(id, user.id);
  if (!inst) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!body || typeof body.path !== 'string' || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'path and content required' }, { status: 400 });
  }

  try {
    const data = await callWorker(db, id, '/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: body.path, content: body.content }),
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
}