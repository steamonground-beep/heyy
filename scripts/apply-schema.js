// Apply db/schema.sql to the DATABASE_URL found in .env (or environment).
// Run: node scripts/apply-schema.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function parseEnv(file) {
  const out = {};
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].trim();
    }
  } catch {}
  return out;
}

const env = { ...parseEnv(path.join(__dirname, '..', '.env')), ...process.env };

if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (check .env)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: /sslmode=require/.test(env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      console.log('OK:', stmt.split('\n').pop().slice(0, 70));
    } catch (e) {
      const isExists = /already exists/i.test(e.message);
      console.log(isExists ? 'SKIP (already):' : 'ERROR:', stmt.split('\n').pop().slice(0, 70), '->', e.message.split('\n')[0]);
      if (!isExists) throw e;
    }
  }

  const { rows } = await pool.query('SELECT key, value FROM settings');
  console.log('\nsettings seeded:', rows);
  const { rows: t } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('tables:', t.map((r) => r.table_name).join(', '));
  await pool.end();
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});