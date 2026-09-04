import { NextResponse } from 'next/server';
import config from 'shared/config';

export const runtime = 'nodejs';

export async function GET() {
  const clientId = config.discordClientId;
  const redirect = config.discordRedirectUri;
  if (!clientId || !redirect) {
    return NextResponse.json({ error: 'Discord OAuth not configured' }, { status: 500 });
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'identify guilds',
  });
  return NextResponse.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
}
