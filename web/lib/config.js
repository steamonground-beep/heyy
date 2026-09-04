// Web app configuration. Same values as the platform .env.example.
module.exports = {
  // Database
  databaseUrl: process.env.DATABASE_URL,

  // Discord OAuth
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
  discordRedirectUri: process.env.DISCORD_REDIRECT_URI,
  discordGuildId: process.env.DISCORD_GUILD_ID,

  // The Discord role whose presence grants the PAID tier.
  paidRoleName: process.env.PAID_ROLE_NAME || 'Paid',

  // Control API secret, used to authorize the VPS worker + the API.
  controlApiSecret: process.env.CONTROL_API_SECRET,

  // The web app's public origin.
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.CONTROL_URL,

  // Environment mode
  isProd: process.env.NODE_ENV === 'production',
};