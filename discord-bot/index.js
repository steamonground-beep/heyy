require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL === 'true' || /sslmode=require/.test(process.env.DATABASE_URL || '')
      ? { rejectUnauthorized: false }
      : undefined,
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
});

const commands = [
  new SlashCommandBuilder()
    .setName('create-account')
    .setDescription('Create your hosting account (linked to your Discord).'),
  new SlashCommandBuilder()
    .setName('account')
    .setDescription('Show your account tier and limits.'),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.application.id, process.env.DISCORD_GUILD_ID), {
      body: commands,
    });
    console.log('Slash commands registered for guild', process.env.DISCORD_GUILD_ID);
  } catch (e) {
    console.error('Failed to register commands', e);
  }
}

// Resolve the paid tier from a member's roles (compare names).
function tierForMember(member) {
  const paidRoleName = process.env.PAID_ROLE_NAME || 'Paid';
  const hasPaidRole = member.roles.cache.some((r) => r.name === paidRoleName);
  return hasPaidRole ? 'paid' : 'free';
}

async function upsertUser(discordId, username, tier) {
  const { rows } = await pool.query(
    `INSERT INTO users (discord_id, discord_username, tier)
     VALUES ($1, $2, $3)
     ON CONFLICT (discord_id)
     DO UPDATE SET discord_username = EXCLUDED.discord_username,
                   tier = EXCLUDED.tier,
                   updated_at = now()
     RETURNING id, discord_id, discord_username, tier, created_at`,
    [discordId, username, tier]
  );
  return rows[0];
}

async function makeLinkCode(userId) {
  const code = crypto.randomBytes(16).toString('hex');
  // Expiry computed by the DB (now() + interval) so a skewed local clock
  // can never make codes look expired before they should be.
  await pool.query(
    'INSERT INTO link_codes (code, user_id, expires_at) VALUES ($1, $2, now() + interval \'15 minutes\')',
    [code, userId]
  );
  return code;
}

async function planSummary(tier) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [
    tier === 'paid' ? 'paid_tier' : 'free_tier',
  ]);
  const p = rows.length ? rows[0].value : { max_instances: tier === 'paid' ? 5 : 1, max_run_hours: tier === 'paid' ? null : 7 };
  return `**${tier === 'paid' ? 'Paid' : 'Free'}**\n- Instances: ${p.max_instances}\n- Runtime: ${p.max_run_hours == null ? 'Unlimited' : p.max_run_hours + ' hours'}`;
}

client.once('ready', async () => {
  console.log(`Bot ready as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'create-account') {
      const member = interaction.member;
      const tier = tierForMember(member);
      const user = await upsertUser(member.id, member.user.username, tier);
      const code = await makeLinkCode(user.id);
      const site = process.env.SITE_URL;
      const embed = new EmbedBuilder()
        .setTitle('Account created')
        .setDescription(`You're all set, ${member.user.username}!`)
        .addFields(
          { name: 'Tier', value: tier === 'paid' ? 'Paid :star:' : 'Free', inline: true },
          { name: 'Discord ID', value: member.id, inline: true },
          { name: 'Link your website session', value: site ? `${site}/api/link/${code}` : 'Site not configured' }
        )
        .setFooter({ text: 'Use /account to see your current limits.' });
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (interaction.commandName === 'account') {
      const member = interaction.member;
      const { rows } = await pool.query('SELECT * FROM users WHERE discord_id = $1', [member.id]);
      const tier = rows.length ? rows[0].tier : tierForMember(member);
      if (!rows.length) {
        await interaction.reply({
          content: 'No account found. Run `/create-account` first.',
          ephemeral: true,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('Account')
        .addFields(
          { name: 'Username', value: member.user.username },
          { name: 'Plan', value: await planSummary(tier) }
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (e) {
    console.error('command error', e);
    await interaction.reply({ content: 'Something went wrong. Try again.', ephemeral: true }).catch(() => {});
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);