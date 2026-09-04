import { NextResponse } from 'next/server';
import db from '../../../../lib/db';
const { query } = db;
import { sign, SESSION_COOKIE, MAX_AGE } from '../../../../lib/session';
import config from '../../../../lib/config';

export const runtime = 'nodejs';

// GET: user clicks the link sent by the bot; consume the code and set a session.
export async function GET(req, { params }) {
  const code = params.code;
  if (!code) return NextResponse.redirect(`${config.siteUrl}/?error=no_code`);

  const { rows } = await query(
    'SELECT * FROM link_codes WHERE code = $1 AND expires_at > now()',
    [code]
  );
  if (!rows.length) {
    return NextResponse.redirect(`${config.siteUrl}/?error=expired_code`);
  }
  const linkCode = rows[0];
  const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1', [linkCode.user_id]);
  if (!userRows.length) {
    return NextResponse.redirect(`${config.siteUrl}/?error=no_user`);
  }
  const user = userRows[0];

  await query('DELETE FROM link_codes WHERE code = $1', [code]);

  const token = sign({ userId: user.id, discordId: user.discord_id, tier: user.tier });
  const res = NextResponse.redirect(`${config.siteUrl}/dashboard`);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: MAX_AGE,
  });
  return res;
}