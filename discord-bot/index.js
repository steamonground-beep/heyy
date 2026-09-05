require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
const { hashPassword } = require(path.join(__dirname, '..', 'web', 'lib', 'passwords'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL === 'true' || /sslmode=require/.test(process.env.DATABASE_URL || '')
      ? { rejectUnauthorized: false }
      : undefined,
});

// Discord user IDs allowed to use /admin (override with OWNER_IDS comma-separated).
const OWNER_IDS = new Set(
  (process.env.OWNER_IDS || '1536290103679262760,1511518989883408434')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

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
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Owner-only account and instance management.')
    .addSubcommand((s) =>
      s.setName('users').setDescription('List all user accounts.')
    )
    .addSubcommand((s) =>
      s
        .setName('user')
        .setDescription('Show a user and their instances.')
        .addStringOption((o) =>
          o.setName('query').setDescription('Username or Discord ID').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('create-login')
        .setDescription('Create an account with a username + password login.')
        .addStringOption((o) =>
          o.setName('username').setDescription('Login username').setRequired(true)
        )
        .addStringOption((o) =>
          o.setName('discord').setDescription('Optional Discord ID to link the account to').setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName('tier')
            .setDescription('Account tier')
            .setRequired(false)
            .addChoices({ name: 'free', value: 'free' }, { name: 'paid', value: 'paid' })
        )
    )
    .addSubcommand((s) =>
      s
        .setName('reset-password')
        .setDescription('Generate a new password for an account.')
        .addStringOption((o) =>
          o.setName('query').setDescription('Username or Discord ID').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('delete-user')
        .setDescription('Delete an account and everything on it (instances stopped first).')
        .addStringOption((o) =>
          o.setName('query').setDescription('Username or Discord ID').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('set-tier')
        .setDescription("Change an account's tier.")
        .addStringOption((o) =>
          o.setName('query').setDescription('Username or Discord ID').setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('tier')
            .setDescription('New tier')
            .setRequired(true)
            .addChoices({ name: 'free', value: 'free' }, { name: 'paid', value: 'paid' })
        )
    )
    .addSubcommand((s) =>
      s
        .setName('ban')
        .setDescription('Ban an account (blocks password and Discord logins).')
        .addStringOption((o) =>
          o.setName('query').setDescription('Username or Discord ID').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('unban')
        .setDescription('Unban an account.')
        .addStringOption((o) =>
          o.setName('query').setDescription('Username or Discord ID').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('instances')
        .setDescription('List instances (optionally for one user).')
        .addStringOption((o) =>
          o.setName('query').setDescription('Username or Discord ID').setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('stop')
        .setDescription('Stop an instance by ID.')
        .addStringOption((o) =>
          o.setName('instance').setDescription('Instance UUID').setRequired(true)
        )
    ),
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

function isOwner(id) {
  return OWNER_IDS.has(id);
}

function makePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

async function uniqueUsername(base) {
  let u = (base || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24) || 'user';
  const taken = await pool.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [u]);
  if (!taken.rows.length) return u;
  for (let i = 0; i < 5; i++) {
    const tryName = u.slice(0, 20) + '_' + Math.random().toString(36).slice(2, 6);
    const r = await pool.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [tryName]);
    if (!r.rows.length) return tryName;
  }
  return u + '_' + Date.now().toString(36).slice(-4);
}

async function makeLinkCode(userId) {
  const code = crypto.randomBytes(16).toString('hex');
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

async function resolveUser(query) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username ILIKE $1 OR discord_id = $1 LIMIT 1',
    [query]
  );
  return rows.length ? rows[0] : null;
}

async function userInstances(userId) {
  const { rows } = await pool.query(
    'SELECT id, name, status, port, public_url, started_at FROM instances WHERE owner_id = $1 ORDER BY created_at',
    [userId]
  );
  return rows;
}

async function daemonStop(instanceId) {
  const base = (process.env.CONTROL_URL || 'http://localhost:4770').replace(/\/+$/, '');
  const secret = process.env.CONTROL_API_SECRET;
  if (!secret) return 'skipped (CONTROL_API_SECRET not set in bot env)';
  try {
    const res = await fetch(`${base}/api/instance/${instanceId}/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    return res.status === 200 || res.status === 404 ? 'stopped' : `daemon replied ${res.status}`;
  } catch (e) {
    return `daemon unreachable: ${e.message}`;
  }
}

function userSummary(user) {
  return [
    `**${user.username || '(no login yet)'}**${user.banned ? ' :no_entry: BANNED' : ''}`,
    `Tier: ${user.tier} · created <t:${Math.floor(new Date(user.created_at).getTime() / 1000)}:R>`,
    `Discord: ${user.discord_username || 'none'} (${user.discord_id || '—'})`,
  ].join('\n');
}

async function replyContext(interaction) {
  const query = interaction.options.getString('query');
  return {
    sub: interaction.options.getSubcommand(),
    query,
    tier: interaction.options.getString('tier'),
  };
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
      const username = await uniqueUsername(member.user.username);
      const password = makePassword();
      const passhash = hashPassword(password);
      const { rows: created } = await pool.query(
        `INSERT INTO users (discord_id, discord_username, username, passhash, tier, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (discord_id)
         DO UPDATE SET discord_username = EXCLUDED.discord_username,
                       username = COALESCE(users.username, EXCLUDED.username),
                       passhash = EXCLUDED.passhash,
                       tier = EXCLUDED.tier,
                       updated_at = now()
         RETURNING *`,
        [member.id, member.user.username, username, passhash, tier]
      );
      const user = created[0];
      const code = await makeLinkCode(user.id);
      const site = process.env.SITE_URL;
      const loginUrl = site ? `${site}/login` : 'the dashboard';
      const embed = new EmbedBuilder()
        .setTitle('Account created')
        .setDescription(`You're all set, ${member.user.username}!`)
        .addFields(
          { name: 'Tier', value: tier === 'paid' ? 'Paid :star:' : 'Free', inline: true },
          { name: 'Discord ID', value: member.id, inline: true },
          { name: 'Website login', value: `${loginUrl}` },
          { name: 'Login username', value: `\`${username}\``, inline: true },
          { name: 'Password', value: `\`${password}\``, inline: true },
          { name: 'Link your Discord session', value: site ? `${site}/api/link/${code}` : 'Site not configured' }
        )
        .setFooter({ text: 'Save your username + password — use /admin reset-password if you lose them (owner only).' });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      try {
        const target = await client.users.fetch(member.id);
        await target.send({
          content:
            `Your **Snakes Hosting** login was created.\n\n` +
            `**Login:** ${loginUrl}\n**User:** \`${username}\`\n**Password:** \`${password}\`\n\n` +
            `Keep this somewhere safe — passwords can only be reset by an owner.`,
        });
      } catch {}
      return;
    }

    if (interaction.commandName === 'account') {
      const member = interaction.member;
      const { rows } = await pool.query('SELECT * FROM users WHERE discord_id = $1', [member.id]);
      const tier = rows.length ? rows[0].tier : tierForMember(member);
      if (!rows.length) {
        await interaction.reply({ content: 'No account found. Run `/create-account` first.', ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('Account')
        .addFields(
          { name: 'Username', value: member.user.username },
          { name: 'Plan', value: await planSummary(tier) }
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (interaction.commandName === 'admin') {
      if (!isOwner(interaction.user.id)) {
        await interaction.reply({ content: ':no_entry: This command is owner-only.', ephemeral: true });
        return;
      }
      const { sub, query, tier } = await replyContext(interaction);
      const embed = new EmbedBuilder().setTitle('Admin');

      if (sub === 'users') {
        const { rows: users } = await pool.query(
          'SELECT * FROM users ORDER BY created_at DESC LIMIT 25'
        );
        if (!users.length) {
          await interaction.reply({ content: 'No users yet.', ephemeral: true });
          return;
        }
        const out = users.map((u) => userSummary(u)).join('\n\n');
        embed.setDescription(out.slice(0, 4000));
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (sub === 'user') {
        const user = await resolveUser(query);
        if (!user) {
          await interaction.reply({ content: 'No account found for that username or Discord ID.', ephemeral: true });
          return;
        }
        const insts = await userInstances(user.id);
        const parts = [userSummary(user), '', '**Instances**'];
        if (!insts.length) parts.push('_none_');
        for (const i of insts.slice(0, 10)) {
          parts.push(`\`${i.id}\` **${i.name}** — ${i.status}${i.port ? ` on :${i.port}` : ''}`);
        }
        embed.setDescription(parts.join('\n').slice(0, 4000));
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (sub === 'create-login') {
        const username = (interaction.options.getString('username') || '').trim().toLowerCase();
        const discord = interaction.options.getString('discord') || null;
        const newTier = tier || 'free';
        if (!/^[a-z0-9_]{3,24}$/.test(username)) {
          await interaction.reply({
            content: ':x: Username must be 3–24 characters of letters, numbers, or underscores.',
            ephemeral: true,
          });
          return;
        }
        const existing = await resolveUser(username);
        if (existing) {
          await interaction.reply({
            content: `:x: Username \`${username}\` is already taken. Use /admin reset-password to change its credentials.`,
            ephemeral: true,
          });
          return;
        }
        if (discord) {
          const linked = await pool.query('SELECT * FROM users WHERE discord_id = $1', [discord]);
          if (linked.rows.length) {
            await interaction.reply({
              content: ':x: That Discord ID is already linked to another account.',
              ephemeral: true,
            });
            return;
          }
        }
        const password = makePassword();
        const passhash = hashPassword(password);
        const { rows: created } = await pool.query(
          `INSERT INTO users (username, passhash, tier, discord_id, discord_username)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [username, passhash, newTier, discord, null]
        );
        const site = process.env.SITE_URL || 'the dashboard';
        embed
          .setTitle('Login created')
          .setDescription(
            `Account \`${username}\` created.\n\n**Login:** ${site}/login\n**User:** \`${username}\`\n**Password:** \`${password}\`\n**Tier:** ${newTier}`
          );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        if (discord) {
          try {
            const target = await client.users.fetch(discord);
            await target.send({
              content: `Your hosting login is ready.\n\n**Login:** ${site}/login\n**User:** \`${username}\`\n**Password:** \`${password}\``,
            });
          } catch {}
        }
        return;
      }

      if (sub === 'reset-password') {
        const user = await resolveUser(query);
        if (!user) {
          await interaction.reply({ content: 'No account found for that username or Discord ID.', ephemeral: true });
          return;
        }
        const password = makePassword();
        await pool.query('UPDATE users SET passhash = $2, updated_at = now() WHERE id = $1', [
          user.id,
          hashPassword(password),
        ]);
        const site = process.env.SITE_URL || 'the dashboard';
        embed
          .setTitle('Password reset')
          .setDescription(
            `**Login:** ${site}/login\n**User:** \`${user.username}\`\n**New password:** \`${password}\``
          );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (sub === 'delete-user') {
        const user = await resolveUser(query);
        if (!user) {
          await interaction.reply({ content: 'No account found for that username or Discord ID.', ephemeral: true });
          return;
        }
        if (isOwner(user.discord_id)) {
          await interaction.reply({ content: ':no_entry: Refusing to delete an owner account.', ephemeral: true });
          return;
        }
        const insts = await userInstances(user.id);
        const results = [];
        for (const i of insts) {
          if (i.status === 'running' || i.status === 'starting') {
            results.push(`\`${i.id}\` ${i.status} → ${await daemonStop(i.id)}`);
          }
        }
        await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
        const lines = [`Account \`${user.username || user.discord_id}\` deleted (${insts.length} instances).`];
        if (results.length) lines.push('', 'Stopped:', ...results);
        if (user.discord_username) lines.push('', `Instance folders on disk were not removed by the bot.`);
        embed.setDescription(lines.join('\n'));
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (sub === 'set-tier') {
        const user = await resolveUser(query);
        if (!user) {
          await interaction.reply({ content: 'No account found for that username or Discord ID.', ephemeral: true });
          return;
        }
        await pool.query('UPDATE users SET tier = $2, updated_at = now() WHERE id = $1', [user.id, tier]);
        await interaction.reply({
          content: `:white_check_mark: \`${user.username || user.discord_id}\` is now **${tier}**.`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'ban' || sub === 'unban') {
        const user = await resolveUser(query);
        if (!user) {
          await interaction.reply({ content: 'No account found for that username or Discord ID.', ephemeral: true });
          return;
        }
        if (isOwner(user.discord_id)) {
          await interaction.reply({ content: ':no_entry: Refusing to ban an owner account.', ephemeral: true });
          return;
        }
        const banned = sub === 'ban';
        await pool.query('UPDATE users SET banned = $2, updated_at = now() WHERE id = $1', [
          user.id,
          banned,
        ]);
        await interaction.reply({
          content: `:white_check_mark: \`${user.username || user.discord_id}\` is now ${banned ? 'banned' : 'unbanned'}.`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'instances') {
        let filter = '';
        let params = [];
        if (query) {
          const user = await resolveUser(query);
          if (!user) {
            await interaction.reply({ content: 'No account found for that username or Discord ID.', ephemeral: true });
            return;
          }
          filter = 'WHERE i.owner_id = $1';
          params = [user.id];
        }
        const { rows: insts } = await pool.query(
          `SELECT i.id, i.name, i.status, i.port, u.username AS owner
           FROM instances i JOIN users u ON i.owner_id = u.id
           ${filter}
           ORDER BY i.created_at DESC LIMIT 25`,
          params
        );
        if (!insts.length) {
          await interaction.reply({ content: 'No instances found.', ephemeral: true });
          return;
        }
        const lines = insts.map(
          (i) => `\`${i.id}\` **${i.name}** (${i.owner}) — ${i.status}${i.port ? ` on :${i.port}` : ''}`
        );
        embed.setDescription(lines.join('\n').slice(0, 4000));
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      if (sub === 'stop') {
        const instanceId = interaction.options.getString('instance');
        await interaction.reply({ content: `Stopping \`${instanceId}\`…`, ephemeral: true });
        const result = await daemonStop(instanceId);
        await interaction.editReply({ content: `:white_check_mark: \`${instanceId}\` ${result}.` });
        return;
      }
    }
  } catch (e) {
    console.error('command error', e);
    await interaction.reply({ content: 'Something went wrong. Try again.', ephemeral: true }).catch(() => {});
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);