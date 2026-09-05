import { NextResponse } from 'next/server';
import config from '../../../../lib/config';
import db from '../../../../lib/db';
const { query } = db;
const { sign, SESSION_COOKIE, MAX_AGE } = require('../../../../lib/session');
import { verifyPassword } from '../../../../lib/passwords';

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    if (!username || !password) {
      return NextResponse.json({ error: 'Missing username or password' }, { status: 400 });
    }

    const { rows } = await query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
    const user = rows.length ? rows[0] : null;
    if (!user || !user.passhash || !verifyPassword(password, user.passhash)) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }
    if (user.banned) {
      return NextResponse.json({ error: 'This account is banned. Contact support.' }, { status: 403 });
    }

    const token = sign({
      userId: user.id,
      discordId: user.discord_id || null,
      tier: user.tier,
      username: user.username,
    });
    const res = NextResponse.json({ ok: true, username: user.username, tier: user.tier });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      path: '/',
      maxAge: MAX_AGE,
    });
    return res;
  } catch (e) {
    console.error('login error', e);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}