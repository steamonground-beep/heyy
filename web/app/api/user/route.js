import { NextResponse } from 'next/server';
import db from 'shared/db';
const { query, upsertUserByDiscord, tierLimits } = db;
import config from 'shared/config';
import { constantTimeEqual } from 'shared/auth';

export const runtime = 'nodejs';

// Create/lookup a user by Discord id. Used by the worker verification
// endpoint and by any service with the shared API secret.
export async function POST(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!constantTimeEqual(token, config.controlApiSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { discordId, username } = body;
  if (!discordId) {
    return NextResponse.json({ error: 'discordId required' }, { status: 400 });
  }
  const user = await upsertUserByDiscord(discordId, username, 'free');
  return NextResponse.json({ user });
}

export async function GET(req) {
  const url = new URL(req.url);
  const discordId = url.searchParams.get('discord_id');
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!constantTimeEqual(token, config.controlApiSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!discordId) {
    return NextResponse.json({ error: 'discord_id required' }, { status: 400 });
  }
  const { rows } = await query('SELECT * FROM users WHERE discord_id = $1', [discordId]);
  if (!rows.length) return NextResponse.json({ user: null });
  const limits = await tierLimits(rows[0].tier);
  return NextResponse.json({ user: rows[0], limits });
}