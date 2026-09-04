// Shared configuration for the hosting platform.
// Uses environment variables. The same .env values must be present on
// Vercel (for the web app) and on the VPS (for the worker + bot).

module.exports = {
  // Database
  databaseUrl: process.env.DATABASE_URL,

  // Discord OAuth
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
  discordRedirectUri: process.env.DISCORD_REDIRECT_URI, // e.g. https://yourdomain.com/api/auth/discord/callback
  discordGuildId: process.env.DISCORD_GUILD_ID,

  // The Discord role whose presence grants the PAID tier.
  paidRoleName: process.env.PAID_ROLE_NAME || 'Paid',

  // Vercel control API base (self URL), plus secret used by workers to authenticate.
  controlUrl: process.env.CONTROL_URL, // e.g. https://yourdomain.com
  controlApiSecret: process.env.CONTROL_API_SECRET,

  // The web app's public origin.
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.CONTROL_URL,

  // Environment mode
  isProd: process.env.NODE_ENV === 'production',
};
