// PostgreSQL client for the Vercel web app (serverless-friendly lazy pool).
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

async function getInstanceRuntime(instanceId) {
  const { rows } = await query(
    'SELECT run_seconds FROM instance_runtime WHERE instance_id = $1',
    [instanceId]
  );
  return rows.length ? Number(rows[0].run_seconds) : 0;
}

// Cumulative runtime for a user across every instance they've ever run.
// This survives instance deletion so the free-tier cap can't be reset by
// deleting + re-creating an instance.
async function getUserUsedSeconds(userId) {
  const { rows } = await query(
    'SELECT COALESCE(used_seconds, 0)::bigint AS s FROM users WHERE id = $1',
    [userId]
  );
  return rows.length ? Number(rows[0].s) : 0;
}

// Return the seconds the user has used within the current daily allowance
// window. Rolls the window forward at midnight (DB timezone): any usage
// recorded in a previous day stops counting toward the 7h free-tier cap.
// Uses FOR UPDATE so concurrent checks (web + worker) can't double-roll.
async function rollFreeUsage(userId) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT used_seconds, period_start, period_base FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return { today_seconds: 0, rolled: false };
    }
    const u = rows[0];
    const days = Math.max(0, Math.floor((Date.now() - new Date(u.period_start).getTime()) / 86400000));
    let rolled = false;
    if (days > 0) {
      await client.query(
        'UPDATE users SET period_start = period_start + make_interval(days => $2), period_base = $3, updated_at = now() WHERE id = $1',
        [userId, days, u.used_seconds]
      );
      rolled = true;
    }
    const { rows: after } = await client.query(
      'SELECT used_seconds, period_base FROM users WHERE id = $1',
      [userId]
    );
    await client.query('COMMIT');
    const today_seconds = Math.max(0, Number(after[0].used_seconds) - Number(after[0].period_base));
    return { today_seconds, rolled };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  query,
  getSetting,
  tierLimits,
  upsertUserByDiscord,
  getInstanceRuntime,
  getUserUsedSeconds,
  rollFreeUsage,
  config,
};