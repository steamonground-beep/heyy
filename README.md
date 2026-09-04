# Snakes Hosting

A hosting platform that lets users spin up game backend instances from a website,
with accounts created and managed through a Discord bot.

## Architecture

```
            ┌─────────────────────────────┐
            │        Vercel (Next.js)     │
            │  - Public website           │
            │  - Discord OAuth login      │
            │  - Dashboard (manage hosts) │
            │  - Control API (worker)     │
            └──────┬──────────────────────┘
                   │  polling (HTTPS)
            ┌──────▼──────────────────────┐
            │     VPS Worker              │
            │  - Spawns backend processes │
            │  - Reports usage ticks      │
            │  - Enforces free tier limit │
            └──────┬──────────────────────┘
                   │
            ┌──────▼──────────────┐
            │   game backend(s)   │
            │   (Node processes)  │
            └─────────────────────┘
```

- **Vercel** hosts the website + Discord OAuth + the worker control API.
- **PostgreSQL** (Neon/Supabase, or on the VPS) stores accounts, instances, usage.
- **Discord bot** creates accounts and determines tier from a role.
- **VPS worker** polls Vercel for work, spawns the game backend Node processes, and
  reports usage so the 7-hour free cap (or unlimited for paid) is enforced.

## Repo layout

```
db/schema.sql        PostgreSQL schema
shared/               shared db/client config used by web + worker + bot
web/                  Next.js app (deploy to Vercel)
discord-bot/          Discord bot (run on your VPS / a small host)
worker/               VPS process spawner/monitor
```

## Setup

### 1. Database

Create a PostgreSQL database (e.g. on Neon — free tier is fine) and run:

```bash
psql -d your_db_url -f db/schema.sql
```

### 2. Discord application & bot

1. Go to <https://discord.com/developers/applications> and create an application.
2. Under **OAuth2** > General, add a redirect URL:
   `https://yourdomain.com/api/auth/discord/callback`
3. Copy the Client ID and Client Secret.
4. Under **Bot**, create a bot, copy the token, enable these privileged intents if needed:
   **Server Members Intent**.
5. Invite the bot to the guild with the `applications.commands` scope.
6. Give users a role named `Paid` (or set `PAID_ROLE_NAME` to your role) to grant the paid tier.

> Ensure the bot + Discord user (for OAuth `guilds` scope) can read guild members so
> the tier check works. If you only use role-based tiering through the bot and never
> the web OAuth role check, the fallback keeps free tier.

### 3. Configure environment

Copy `.env.example` and fill in values. This same env is deployed to Vercel and the VPS.

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `DISCORD_CLIENT_ID` / `SECRET` | Discord OAuth app credentials |
| `DISCORD_REDIRECT_URI` | https://yourdomain.com/api/auth/discord/callback |
| `DISCORD_GUILD_ID` | Server ID where the bot lives |
| `DISCORD_BOT_TOKEN` | Bot token (used by worker + web for role lookups) |
| `PAID_ROLE_NAME` | Discord role that marks a user paid |
| `SITE_URL` | Public site URL |
| `CONTROL_URL` | Public site URL (same) |
| `CONTROL_API_SECRET` | Shared secret workers use to hit the control API |
| `SESSION_SECRET` | Secret used to sign the website session cookie |
| `BACKEND_DIR` | *(VPS only)* Path to game backend source containing `server.js` |
| `START_PORT` | *(VPS only)* First port to allocate |
| `MAX_INSTANCES` | *(VPS only)* Concurrent processes allowed |
| `WORKER_HOST` | *(VPS only)* Label for this node |
| `WORKER_PUBLIC_HOST` | *(VPS only)* Publicly reachable IP/hostname of the VPS; shown to users as the connection URL |

### 4. Deploy the web app to Vercel

```bash
cd web
npm install
vercel --prod
```

Set the same env vars in the Vercel dashboard (Settings → Environment Variables).
The app is configured as `web/` — if you’re deploying from the repo root, set
`Root Directory` to `web`.

### 5. Run the Discord bot

```bash
cd discord-bot
npm install
node index.js
```

### 6. Run the worker on your VPS

```bash
cd worker
npm install
node index.js
```

The backend needs its dependencies installed once on the VPS:

```bash
cd /opt/backends/server   # your BACKEND_DIR
npm install
```

> **Open the instance ports on the VPS.** Each running backend uses its own port
> starting at `START_PORT` (3800 by default). Open this range in your firewall /
> security group so players can connect.

## How the free tier 7-hour cap works

1. The worker records a usage tick (60s) to `/api/worker/tick` for each running instance.
2. `instance_runtime` accumulates `run_seconds` per instance.
3. When a free user hits **Start**, the API checks their total accumulated seconds
   against the free cap (7h). If exceeded, start is blocked.
4. The worker also enforces the cap server-side: any running free instance whose
   accumulated runtime crosses the limit is terminated.

## Security notes

- The control API endpoints under `/api/worker/*` require `Authorization: Bearer
  <CONTROL_API_SECRET>`. Keep this secret private.
- The website session cookie is signed with `SESSION_SECRET`.
- Never commit `.env` files.