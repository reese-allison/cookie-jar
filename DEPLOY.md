# Deploying to Fly.io

One-Machine deploy: Fly runs the app, Fly Postgres (legacy single-node)
holds durable state, Upstash Redis holds cluster-scoped socket state.
Target cost: ~$6/mo. Sized for 50 concurrent rooms × 5 users per the
bench in `tests/load/bench.ts`.

> **Pick your app names up front.** The examples below use `cookie-jar`
> and `cookie-jar-db`, but `cookie-jar` is often globally taken — if so,
> `fly apps create` will fail and you'll need a unique name like
> `the-cookie-jar`, `<yourname>-cookie-jar`, etc. Whatever you choose,
> substitute it consistently for `cookie-jar` in every command below AND
> in `fly.toml` (line starting with `app =`). A mismatch between your
> fly.toml value, the name in `fly apps create`, and the `--app` flag
> in secrets/attach commands is the #1 source of early deploy pain.

## Prereqs

- [flyctl](https://fly.io/docs/flyctl/install/) installed (`brew install flyctl`)
- A Fly.io account with a payment method attached
- An Upstash account (free tier is fine): <https://upstash.com>
- A domain you control if you want a custom hostname (optional — `<app>.fly.dev` works)

## 1. First-time setup

### 1a. Create the app

```bash
fly auth login
fly apps create cookie-jar   # or whatever unique name you picked
```

If the name is taken, `fly apps create` prints `Error: already taken`.
Pick another, update `fly.toml` (`app = "..."`), and retry.

### 1b. Provision Postgres

```bash
# Single-node development cluster — the cheap option (~$2/mo).
fly postgres create \
  --name cookie-jar-db \
  --region iad \
  --initial-cluster-size 1 \
  --vm-size shared-cpu-1x \
  --volume-size 1

# Attach it — creates a database + user on the cluster and injects
# DATABASE_URL into the app's secrets automatically.
fly postgres attach cookie-jar-db --app cookie-jar
```

Fly Postgres (legacy) has no automatic PITR backups. If data ever
matters, set up a periodic `pg_dump` — a GitHub Actions schedule that
SSHes in, dumps, and pushes to S3/B2 is ~30 lines. Or upgrade to
Managed Postgres (~$29/mo) for backups built-in.

### 1c. Provision Redis (Upstash)

1. Log into <https://console.upstash.com/>.
2. **Create Database → Redis**. Pick the same region as your Fly app
   (`us-east-1` for `iad`). Free tier: 256 MB, 500k commands/day.
3. On the database detail page, copy the **TLS** connection string —
   the one that starts with `rediss://` (two s's). ioredis needs TLS
   for Upstash connections; `redis://` will silently fail to connect.

```bash
fly secrets set REDIS_URL='rediss://default:PASSWORD@YOUR-HOST.upstash.io:6379' --app cookie-jar
```

Single-quote the URL to protect special characters in the password.

### 1d. Generate the auth secret

```bash
fly secrets set BETTER_AUTH_SECRET="$(openssl rand -hex 32)" --app cookie-jar
```

### 1e. Set the public URLs

**CRITICAL**: these must match the origin users actually load the app
from. A mismatch produces `INVALID_CALLBACK_URL` 403s on every sign-in
attempt. No trailing slash, exact hostname.

**Using `<app>.fly.dev` (zero DNS work):**

```bash
fly secrets set \
  BETTER_AUTH_URL=https://cookie-jar.fly.dev \
  CLIENT_URL=https://cookie-jar.fly.dev \
  --app cookie-jar
```

**Using a custom domain:**

```bash
fly certs create cookie-jar.example.com --app cookie-jar
# Add the AAAA / A records it prints to your DNS. Wait for propagation.
fly secrets set \
  BETTER_AUTH_URL=https://cookie-jar.example.com \
  CLIENT_URL=https://cookie-jar.example.com \
  --app cookie-jar
```

### 1f. OAuth providers (recommended)

```bash
fly secrets set \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  DISCORD_CLIENT_ID=... \
  DISCORD_CLIENT_SECRET=... \
  --app cookie-jar
```

**Register production callback URLs** at each provider. Missing this
step causes provider-side `redirect_uri_mismatch` errors on sign-in.

- Google Cloud Console → Credentials → OAuth 2.0 Client → **Authorized
  redirect URIs**, add: `https://<your-url>/api/auth/callback/google`
- Discord Developer Portal → your app → OAuth2 → **Redirects**, add:
  `https://<your-url>/api/auth/callback/discord`

Leave your localhost callbacks in place; both providers support
multiple redirect URIs.

### 1g. First deploy

```bash
fly deploy
```

Expected flow (~3–5 minutes):

1. Fly builds the image via `Dockerfile`.
2. `release_command` spins up a throwaway Machine and runs
   `scripts/bootstrap-and-migrate.mjs`, which applies `schema.sql` on
   first-ever deploy and runs any pending migrations.
3. On success, the new image rolls out to the app Machine.

Verify:

```bash
curl -s https://cookie-jar.fly.dev/api/live
# → {"status":"ok"}
```

Visit the app URL in a browser. Sign in with Google or Discord.

## 2. Ongoing deploys

```bash
git pull
fly deploy
```

Migrations run automatically. Zero-downtime rolling replace. The PWA
service worker auto-updates on the next normal reload thanks to
`skipWaiting` + `clientsClaim` in `vite.config.ts`.

## 3. Common operations

| Task | Command |
|---|---|
| Tail logs | `fly logs --app cookie-jar` |
| App status | `fly status --app cookie-jar` |
| Postgres logs | `fly logs -a cookie-jar-db` |
| SSH into app | `fly ssh console --app cookie-jar` |
| List secrets | `fly secrets list --app cookie-jar` |
| Unset a secret | `fly secrets unset FOO --app cookie-jar` |
| Previous releases | `fly releases --app cookie-jar` |
| Roll back | `fly deploy --image registry.fly.io/cookie-jar:v<N>` |
| Seed templates | `fly ssh console --app cookie-jar -C "bun run src/server/db/seed-templates.ts"` |

## 4. Scaling

Bench showed 512 MB fits 50×5 (peak ~360 MB). If you hit OOM restarts
(`fly status` shows non-zero restart count), bump memory:

```toml
# fly.toml
[[vm]]
  memory = "1024mb"
```

Then `fly deploy`. Or horizontally (`fly scale count 2`) — the app is
multi-pod correct via the Redis adapter + presence/dedup stores.

## 5. Teardown

```bash
fly apps destroy cookie-jar       # destroys the app + its Machines
fly apps destroy cookie-jar-db    # destroys the Postgres cluster + volume
# Then delete the Upstash Redis database from their console.
```

---

## Appendix: gotchas we actually hit

If this is a fresh deploy and something goes wrong, the issue is
probably one of these. Listed in the order they bit us.

### App name mismatch (`unauthorized` on `fly deploy`)

If `fly.toml`'s `app = "..."` doesn't match the app you created,
`fly deploy` errors with `unauthorized` (you're trying to deploy to an
app you don't own). Fix: `fly apps list`, then edit `fly.toml` to
match.

### `release_command` can't find `node-pg-migrate`

`node-pg-migrate` is used only at deploy time but must be in
`dependencies` (not `devDependencies`), because `bun install --production`
in the runtime image skips devDeps. Currently lives in dependencies —
if you ever split it out, remember to also revisit the Dockerfile's
`rm -rf` list.

### Bun doesn't tolerate node-pg-migrate's optional imports

`node-pg-migrate` uses a `tryImport` helper that catches Node's
`ERR_MODULE_NOT_FOUND` error code. Bun's resolver throws a different
error type, so every optional import (dotenv, dotenv-expand, json5,
ts-node, config, tsx/esm) would crash the bin script. Fix: install
Node alongside Bun in the runtime image (see Dockerfile, `apk add
--no-cache nodejs`) and invoke migrations with `node`, not `bun`.

### Empty Postgres on first deploy (`relation "notes" does not exist`)

Fly Postgres doesn't run `docker-entrypoint-initdb.d` the way local
compose does. `schema.sql` never gets applied, so the incremental
migrations fail. `scripts/bootstrap-and-migrate.mjs` handles this:
it probes for the `users` table and applies `schema.sql` on the
first-ever deploy. After that, every migration file is marked as
already applied (because per project policy, `schema.sql` is kept in
sync with the post-migration state, so replaying migrations would
collide on implicitly-named constraints).

### `INVALID_CALLBACK_URL` on sign-in

better-auth rejects a sign-in when the client's `callbackURL` isn't in
the server's `trustedOrigins` list. `trustedOrigins` is seeded from
the `CLIENT_URL` secret in `src/server/auth.ts`. Check:

```bash
fly ssh console --app cookie-jar -C 'sh -c "echo CLIENT_URL=[$CLIENT_URL]"'
```

Common failures:
- Wrong hostname (e.g. `cookie-jar.fly.dev` when the real URL is `the-cookie-jar.fly.dev`)
- Trailing slash
- `http://` instead of `https://`
- Accidentally missing altogether (defaults to `http://localhost:5175`)

Fix by re-running `fly secrets set CLIENT_URL=... BETTER_AUTH_URL=...`.

### Google Fonts / PWA manifest blocked by CSP

If you ever tighten the CSP in `src/server/middleware/securityHeaders.ts`,
remember: the app serves its own client bundle AND depends on
external Google Fonts. `styleSrc` and `fontSrc` need `https:`;
`manifestSrc` needs `'self'` for `vite-plugin-pwa`'s
`manifest.webmanifest`; `connectSrc` needs `ws:` + `wss:` for socket.io.

### Stale service worker after deploy

`vite-plugin-pwa` is configured with `skipWaiting`/`clientsClaim`/
`cleanupOutdatedCaches` in `vite.config.ts`, so new deploys propagate
on the next normal reload. If someone loaded the site before this
config shipped, they'll still be on the old SW and need a one-time
manual cleanup:

- Chrome: `chrome://serviceworkers/` → unregister; settings →
  delete cookies for the site; close all tabs; reload.
- Safari: Develop menu → Service Workers → delete; Empty Caches;
  close all tabs; reload.
- Firefox: `about:serviceworkers` → unregister; clear cache.

### Upstash `MaxRetriesPerRequest`

If ioredis logs `reach maxRetriesPerRequest limitation` and the app
can't do anything Redis-related:
- `REDIS_URL` is probably `redis://` (plain) instead of `rediss://` (TLS).
  Upstash requires TLS.
- Or the password contains unencoded special characters.
- Or you hit Upstash's free-tier connection cap (rare — app opens 6).

Check with `fly ssh console -a cookie-jar -C 'sh -c "echo $REDIS_URL | cut -c1-8"'` — output should start with `rediss://`.

### Stale SW serving OLD CSP (seeing fixed errors still)

When the CSP changes, the *server* may already be serving the new
header but a user's browser is still under the control of the old
service worker serving a cached `index.html` response (with the old
header attached). `curl -sI https://<your-url>/ | grep -i content-security-policy`
shows the real server-side policy. Browser errors showing the old
policy after a deploy means the SW needs cleaning (see above).
