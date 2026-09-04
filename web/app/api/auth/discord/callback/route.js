import { NextResponse } from 'next/server';
import config from '../../../../../lib/config';
import db from '../../../../../lib/db';
const { query, upsertUserByDiscord } = db;
const { sign, SESSION_COOKIE, MAX_AGE } = require('../../../../../lib/session');

export const runtime = 'nodejs';

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.discordClientId,
    client_secret: config.discordClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.discordRedirectUri,
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('token exchange failed ' + res.status);
  return res.json();
}

async function fetchMe(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}

async function myGuilds(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.ok ? res.json() : [];
}

// Determine paid status by reading the member's roles in the configured guild.
// Uses the bot token so it works with just the "identify guilds" OAuth scopes.
async function determineTier(accessToken, userId) {
  const guildId = config.discordGuildId;
  const paidRoleName = config.paidRoleName;
  if (!guildId) return 'free';

  try {
    const guilds = await myGuilds(accessToken);
    const isMember = guilds.some((g) => g.id === guildId);
    if (!isMember) return 'free';

    if (!process.env.DISCORD_BOT_TOKEN) return 'free';
    const botAuth = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };

    // Fetch the guild roles (bot token) to map name -> id.
    const g = await fetch(`https://discord.com/api/guilds/${guildId}`, {
      headers: botAuth,
    });
    if (!g.ok) return 'free';
    const guild = await g.json();
    const paidRole = (guild.roles || []).find((r) => r.name === paidRoleName);
    if (!paidRole) return 'free';

    // Fetch the member's role ids (bot token).
    const m = await fetch(`https://discord.com/api/guilds/${guildId}/members/${userId}`, {
      headers: botAuth,
    });
    if (!m.ok) return 'free';
    const member = await m.json();
    const hasPaid = (member.roles || []).includes(paidRole.id);
    return hasPaid ? 'paid' : 'free';
  } catch (e) {
    console.error('tier determination error', e);
    return 'free';
  }
}

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(`${config.siteUrl}/?error=no_code`);
  }

  try {
    const tokens = await exchangeCode(code);
    const accessToken = tokens.access_token;
    const me = await fetchMe(accessToken);
    if (!me.id) {
      return NextResponse.redirect(`${config.siteUrl}/?error=discord_failed`);
    }

    const tier = await determineTier(accessToken, me.id);
    const user = await upsertUserByDiscord(me.id, me.username, tier);

    const token = sign({ userId: user.id, discordId: me.id, tier: user.tier });
    const res = NextResponse.redirect(`${config.siteUrl}/dashboard`);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      path: '/',
      maxAge: MAX_AGE,
    });
    return res;
  } catch (e) {
    console.error('oauth callback error', e);
    return NextResponse.redirect(`${config.siteUrl}/?error=oauth_failed`);
  }
}
