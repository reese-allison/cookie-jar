# Deploying to Fly.io

One-Machine deploy: Fly runs the app, Fly Postgres (legacy single-node) holds
durable state, Upstash Redis holds cluster-scoped socket state. Target
cost: ~$6/mo. Sized for 50 concurrent rooms × 5 users per the bench in
`tests/load/bench.ts`.

## Prereqs

- [flyctl](https://fly.io/docs/flyctl/install/) installed (`brew install flyctl`)
- A Fly.io account with a payment method attached
- An Upstash account (free tier is fine): <https://upstash.com>
- A domain you control if you want a custom hostname (optional — `<app>.fly.dev` works)

## 1. First-time setup

### 1a. Create the app

```bash
fly auth login
# Skip `fly launch` — we already have fly.toml. Just create the app.
fly apps create cookie-jar
```

If the name `cookie-jar` is taken globally, change `app = ` in `fly.toml`
to something unique before running `fly apps create`.

### 1b. Provision Postgres

```bash
# Single-node development cluster — the cheap option (~$2/mo).
fly postgres create \
  --name cookie-jar-db \
  --region iad \
  --initial-cluster-size 1 \
  --vm-size shared-cpu-1x \
  --volume-size 1

# Attach it — this creates a database + user and injects DATABASE_URL
# into the app's secrets automatically.
fly postgres attach cookie-jar-db --app cookie-jar
```

Copy the connection string it prints somewhere safe (password won't be
shown again without extra work).

### 1c. Provision Redis (Upstash)

1. Log into <https://console.upstash.com/>.
2. Create Database → Redis → pick the same region as your Fly app (e.g.
   `us-east-1` for `iad`). Free tier: 256 MB, 500k commands/day.
3. Copy the **TLS** connection string (starts with `rediss://`).

```bash
fly secrets set REDIS_URL='rediss://default:...@...upstash.io:6379' --app cookie-jar
```

### 1d. Generate the auth secret

```bash
fly secrets set BETTER_AUTH_SECRET="$(openssl rand -hex 32)" --app cookie-jar
```

### 1e. Set the public URLs

Pick one:

**Using `<app>.fly.dev` (zero DNS work):**

```bash
fly secrets set \
  BETTER_AUTH_URL=https://cookie-jar.fly.dev \
  CLIENT_URL=https://cookie-jar.fly.dev \
  --app cookie-jar
```

**Using a custom domain:**

```bash
# 1. Add the cert request first.
fly certs create cookie-jar.example.com --app cookie-jar
# 2. Add the AAAA / A records it prints to your DNS.
# 3. Once propagated:
fly secrets set \
  BETTER_AUTH_URL=https://cookie-jar.example.com \
  CLIENT_URL=https://cookie-jar.example.com \
  --app cookie-jar
```

### 1f. (Optional) OAuth providers

Only needed if you want real sign-in. The app runs without these — users
just won't have a way to authenticate in production.

```bash
fly secrets set \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  DISCORD_CLIENT_ID=... \
  DISCORD_CLIENT_SECRET=... \
  --app cookie-jar
```

**OAuth callback URLs** — register these with each provider:

- Google: `https://<your-url>/api/auth/callback/google`
- Discord: `https://<your-url>/api/auth/callback/discord`

Trusted origins already flow through `CLIENT_URL` — no extra config.

### 1g. First deploy

```bash
fly deploy
```

What happens:

1. Fly builds the image using `Dockerfile`.
2. The `release_command` spins up a temporary Machine and runs
   `node-pg-migrate up`. If migrations fail, the deploy aborts — the
   old version keeps serving.
3. On success, the new image rolls out to the app Machine.
4. `fly deploy` tails the logs until the new version is healthy.

Visit `https://<your-url>/api/live` — should return `{"status":"ok"}`.

## 2. Ongoing deploys

```bash
git pull
fly deploy
```

That's it. New migrations run automatically via `release_command`.
Zero-downtime thanks to Fly's rolling replace.

## 3. Common operations

### Check status

```bash
fly status --app cookie-jar
fly logs --app cookie-jar
fly logs -a cookie-jar-db         # Postgres logs
```

### Run a one-off command

```bash
fly ssh console --app cookie-jar
# You're inside the Machine. Run anything: bun, psql via DATABASE_URL, etc.
```

### Roll back

```bash
fly releases --app cookie-jar     # list past releases
fly deploy --image registry.fly.io/cookie-jar:v<N>
```

### Seed templates

```bash
fly ssh console --app cookie-jar -C "bun run src/server/db/seed-templates.ts"
```

## 4. Backups

Legacy Fly Postgres has no automatic point-in-time recovery. Snapshots are
manual. For a weekly safety net:

```bash
fly postgres backup --app cookie-jar-db
```

Or, better, schedule a `pg_dump` to an off-cluster location. A GitHub
Actions scheduled job that SSHes in, dumps, and pushes to S3 / B2 is
~40 lines of yaml and costs near-zero.

If PITR backups matter to you, the upgrade is Managed Postgres (MPG) —
more expensive (~$29/mo) but handled for you. See `fly mpg create`.

## 5. Scaling up

Per the bench, 512 MB fits 50×5 with ~150 MB headroom and no CPU pressure.
If you see OOM restarts (`fly status` will show restarts) or p95 latency
creep past 100 ms, bump memory:

```bash
# Edit fly.toml: memory = "1024mb"
fly deploy
```

Or horizontally:

```bash
fly scale count 2 --app cookie-jar
```

The app is multi-pod-correct already (Redis adapter + dedup/presence
stores) so horizontal scaling Just Works.

## 6. Cost check

Verify you're hitting the budget target:

```bash
fly billing --org <your-org>
```

Expected monthly, steady-state:

| Line item | Cost |
|---|---|
| App Machine (shared-cpu-1x@512MB) | ~$3.89 |
| Fly Postgres (shared-cpu-1x@256MB + 1 GB volume) | ~$2 |
| Upstash Redis (free tier) | $0 |
| Outbound bandwidth (within free 160 GB/mo) | $0 |
| **Total** | **~$6** |

Fly has a $5/mo minimum-spend floor on current plans, so anything under
that rounds up.

## 7. Teardown

If you want to blow it all away:

```bash
fly apps destroy cookie-jar
fly apps destroy cookie-jar-db
# Then delete the Upstash Redis database from their console.
```
