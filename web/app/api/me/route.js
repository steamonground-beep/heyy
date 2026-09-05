import { NextResponse } from 'next/server';
import db from '../../../lib/db';
const { query } = db;
import { getCurrentUser } from '../../../lib/auth';

export const runtime = 'nodejs';

export async function GET(req) {
  const user = await getCurrentUser(req, { query });
  if (!user) return NextResponse.json({ user: null });
  const { rows } = await query(
    'SELECT id, discord_username, tier, banned, used_seconds, created_at FROM users WHERE id = $1',
    [user.id]
  );
  return NextResponse.json({ user: rows[0] || null });
}