import { NextResponse } from 'next/server';
import db from '../../../lib/db';
const { query, rollFreeUsage } = db;
import { getCurrentUser } from '../../../lib/auth';

export const runtime = 'nodejs';

export async function GET(req) {
  const user = await getCurrentUser(req, { query });
  if (!user) return NextResponse.json({ user: null });
  const { rows } = await query(
    'SELECT id, discord_username, tier, banned, used_seconds, created_at FROM users WHERE id = $1',
    [user.id]
  );
  const u = rows[0] || null;
  if (!u) return NextResponse.json({ user: null });
  const { today_seconds } = await rollFreeUsage(user.id);
  u.today_used_seconds = today_seconds;
  return NextResponse.json({ user: u });
}