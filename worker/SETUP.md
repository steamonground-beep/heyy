# Worker VPS Setup

The worker runs each customer's game backend inside an isolated per-instance folder
and exposes a daemon API (file manager / logs / restart) that the web app calls back
into. It must run on a server that Vercel can reach (a VPS with a public IP), not on
a local PC.

## 1. Provision a VPS

- Ubuntu 22.04 / 24.04, at least 1 vCPU / 2 GB RAM.
- Open ports in the provider firewall AND the OS firewall:
  - `22/tcp` — SSH
  - `4770/tcp` — worker daemon API (used by the web app)
  - `3800-3899/tcp` — per-instance game backends (players connect here)

## 2. Install Node 20 LTS + git

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # expect v20.x
```

## 3. Put the game backend on the VPS

The backend (the folder containing `server.js`) is **not** in the repo. From your PC:

```powershell
scp -r "C:\Users\jdray\Downloads\Project RS Backends (Snakes Backends)\Project RS Backends (Snakes Backends)" user@VPS_IP:/opt/backends/server
```

Then install its dependencies on the VPS:

```bash
sudo mkdir -p /opt/backends && sudo chown -R $USER /opt/backends
mv /opt/backends/server "/opt/backends/Project RS Backends (Snakes Backends)" /dev/null 2>/dev/null || true
cd /opt/backends/server && npm install
```

> `npm install` in the backend folder is required — the worker symlinks the instance's
> `node_modules` to this one, so it must exist here with the correct native modules
> (better-sqlite3 is built for this exact OS/architecture).

## 4. Clone the platform repo and configure the worker

```bash
git clone https://github.com/steamonground-beep/heyy.git /opt/snakes-hosting
cd /opt/snakes-hosting/worker && npm install
cp .env.example .env
```

Edit `/opt/snakes-hosting/worker/.env` and fill in:

```
CONTROL_URL=https://www.rayvo.me
CONTROL_API_SECRET=<same secret as Vercel>
DATABASE_URL=postgresql://...neondb?sslmode=require
BACKEND_DIR=/opt/backends/server
INSTANCES_DIR=/opt/backends/instances
START_PORT=3800
MAX_INSTANCES=20
WORKER_HOST=vps-1
WORKER_PUBLIC_HOST=<VPS public IP>
WORKER_API_PORT=4770
```

- `CONTROL_API_SECRET` must match the `CONTROL_API_SECRET` set in Vercel (web app).
- `WORKER_PUBLIC_HOST` is the IP players connect to for their game server.

## 5. Open the OS firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 4770/tcp
sudo ufw allow 3800:3899/tcp
sudo ufw enable
```

## 6. Run the worker 24/7 with pm2

```bash
sudo npm install -g pm2
cd /opt/snakes-hosting/worker
pm2 start index.js --name snakes-worker
pm2 save
pm2 startup   # run the command it prints
```

Check it came up:

```bash
pm2 logs snakes-worker --lines 20
```

You should see `Daemon API listening on :4770` and no `heartbeat failed`.

Verify registration (from anywhere):

```bash
curl -H "Authorization: Bearer <CONTROL_API_SECRET>" https://www.rayvo.me/api/worker/register/health
```

## 7. (Optional) Move the Discord bot to the VPS too

The bot (`/create-account`, `/account`) currently runs on your PC and stops when it's
off. Run it on the VPS for 24/7:

```bash
cd /opt/snakes-hosting/discord-bot
npm install
cp /opt/snakes-hosting/.env.example .env   # fill in real secrets
pm2 start index.js --name snakes-discord-bot
pm2 save
```

## Testing after setup

1. On the website: `www.rayvo.me/dashboard` → **Create** an instance.
2. Hit **Start** — the worker copies the backend into `/opt/backends/instances/<id>`,
   writes a fresh `.env`, and runs it on a port from 3800 up.
3. **Manage** → Files / Settings / Console should now load live from the VPS.