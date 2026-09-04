// Shared PostgreSQL client. Lazy pool creation so it works in both
// long-running Node (worker, bot) and serverless (Next.js on Vercel).

const { Pool } = require('pg');
const config = require('./config');

let pool = null;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: process.env.PGSSL === 'true' || /sslmode=require/.test(config.databaseUrl || '')
        ? { rejectUnauthorized: false }
        : undefined,
      max: 10,
    });
    pool.on('error', (err) => {
      console.error('idle pool error', err);
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function getSetting(key) {
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

// Tier limits lookup from settings table.
async function tierLimits(tier) {
  const key = tier === 'paid' ? 'paid_tier' : 'free_tier';
  const val = await getSetting(key);
  return (
    val || {
      max_instances: tier === 'paid' ? 5 : 1,
      max_run_hours: tier === 'paid' ? null : 7,
    }
  );
}

async function upsertUserByDiscord(discordId, discordUsername, tier) {
  const { rows } = await query(
    `INSERT INTO users (discord_id, discord_username, tier)
     VALUES ($1, $2, $3)
     ON CONFLICT (discord_id)
     DO UPDATE SET discord_username = EXCLUDED.discord_username,
                   tier = EXCLUDED.tier,
                   updated_at = now()
     RETURNING *`,
    [discordId, discordUsername, tier]
  );
  return rows[0];
}

// Compute current running seconds for an instance (sum of lifetime counts).
async function getInstanceRuntime(instanceId) {
  const { rows } = await query(
    'SELECT run_seconds FROM instance_runtime WHERE instance_id = $1',
    [instanceId]
  );
  return rows.length ? Number(rows[0].run_seconds) : 0;
}

module.exports = {
  getPool,
  query,
  getSetting,
  tierLimits,
  upsertUserByDiscord,
  getInstanceRuntime,
  config,
};
