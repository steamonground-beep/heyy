import { NextResponse } from 'next/server';
import db from '../../../lib/db';
const { query, tierLimits, getInstanceRuntime } = db;
import { getCurrentUser } from '../../../lib/auth';

export const runtime = 'nodejs';

// Validate instance name for safety.
function validName(name) {
  return typeof name === 'string' && name.length >= 1 && name.length <= 40;
}

// ---- LIST + CREATE (auth) ----
export async function GET(req) {
  const user = await getCurrentUser(req, { query });
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { rows } = await query(
    `SELECT i.*, COALESCE(r.run_seconds, 0) AS run_seconds
     FROM instances i
     LEFT JOIN instance_runtime r ON r.instance_id = i.id
     WHERE i.owner_id = $1
     ORDER BY i.created_at DESC`,
    [user.id]
  );
  const limits = await tierLimits(user.tier);
  return NextResponse.json({ instances: rows, limits, tier: user.tier });
}

export async function POST(req) {
  const user = await getCurrentUser(req, { query });
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!validName(name)) {
    return NextResponse.json({ error: 'invalid name' }, { status: 400 });
  }

  const limits = await tierLimits(user.tier);
  const { rows: countRows } = await query(
    'SELECT COUNT(*)::int AS c FROM instances WHERE owner_id = $1',
    [user.id]
  );
  if (countRows[0].c >= limits.max_instances) {
    return NextResponse.json(
      { error: `instance limit reached (${limits.max_instances})` },
      { status: 400 }
    );
  }

  const { rows } = await query(
    `INSERT INTO instances (owner_id, name, status, config)
     VALUES ($1, $2, 'stopped', $3)
     RETURNING *`,
    [user.id, name, JSON.stringify(body.config || {})]
  );

  // idempotent runtime row
  await query(
    'INSERT INTO instance_runtime (instance_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [rows[0].id]
  );

  return NextResponse.json({ instance: rows[0] }, { status: 201 });
}