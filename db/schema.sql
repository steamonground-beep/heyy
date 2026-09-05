-- Snakes Hosting - PostgreSQL schema
-- Run with: psql -d snakes_hosting -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- An application user account. Created via the Discord bot (or role-based).
CREATE TABLE IF NOT EXISTS users (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_id       TEXT UNIQUE,                -- Discord user snowflake
    discord_username TEXT,
    email            TEXT UNIQUE,                -- optional, if captured later
    username         TEXT UNIQUE,                -- real login username (bot issues it)
    passhash         TEXT,                       -- scrypt hash "salt:hash" for password logins
    banned           BOOLEAN NOT NULL DEFAULT false,
    tier             TEXT NOT NULL DEFAULT 'free'
                     CHECK (tier IN ('free', 'paid')),
    paid_role        TEXT,                       -- snapshot of the Discord role name that grants paid
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username) WHERE username IS NOT NULL;

-- A single "hosting instance" = one spawned game backend process for a user.
-- Free tier: 1 instance max, max 7 hours of run time.
-- Paid tier: 5 instances max, unlimited runtime.
CREATE TABLE IF NOT EXISTS instances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,               -- user-facing label
    port            INTEGER,                     -- host port assigned for this instance
    public_url      TEXT,                        -- e.g. ws://<host>:<port> or a proxied URL
    status          TEXT NOT NULL DEFAULT 'stopped'
                    CHECK (status IN ('stopped', 'starting', 'running', 'stopping', 'error')),
    -- runtime accounting (seconds that the process has actually been up)
    state           TEXT,                        -- 'running' | 'paused' (control from user)
    started_at      TIMESTAMPTZ,
    last_seen_at    TIMESTAMPTZ,                 -- last heartbeat from the worker
    worker_host     TEXT,                        -- which VPS node it runs on
    config          JSONB NOT NULL DEFAULT '{}', -- per-instance options (ram, etc)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Periodic usage snapshots recorded by the worker, used to enforce the
-- free-tier 7-hour cap and to do accounting.
CREATE TABLE IF NOT EXISTS usage_ticks (
    id           BIGSERIAL PRIMARY KEY,
    instance_id  UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    seconds      INTEGER NOT NULL,               -- seconds running during this tick
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_ticks_instance ON usage_ticks(instance_id, recorded_at);

-- A running tick counter per instance so the free-tier cap can be checked
-- without summing the whole history every time.
CREATE TABLE IF NOT EXISTS instance_runtime (
    instance_id UUID PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
    run_seconds BIGINT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OAuth "link" codes so a user can associate their Discord with a website
-- session before they have logged in via the site (bot -> account creation).
CREATE TABLE IF NOT EXISTS link_codes (
    code         TEXT PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);

-- Simple key/value for platform settings (e.g. free tier hours).
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Worker nodes that are allowed to poll the control API.
CREATE TABLE IF NOT EXISTS workers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    secret     TEXT NOT NULL,                    -- HMAC secret used as API key
    last_seen  TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
    ('free_tier',    '{"max_instances": 1, "max_run_hours": 7}'),
    ('paid_tier',    '{"max_instances": 5, "max_run_hours": null}'),
    ('paid_role',    '{"name": "Paid"}')
ON CONFLICT (key) DO NOTHING;
