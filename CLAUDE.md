# Cookie Jar

A real-time collaborative web app where groups share a virtual jar of user-created notes and pull them out at random. Jackbox-style room codes, live cursors, tactile drag-and-drop interactions.

## Development Philosophy

### Test-Driven Development (TDD)

**All new features must follow TDD.** The workflow is:

1. Write failing tests first that describe the desired behavior
2. Write the minimum code to make the tests pass
3. Refactor while keeping tests green

No feature code should be written without a corresponding test written beforehand. This applies to backend logic, API routes, real-time event handlers, and frontend component behavior.

#### Coverage gate: `bun run test:missing`

Run `bun run test:missing` before pushing. It scans the four client folders that follow strict 1:1 filename mirroring (`components/`, `hooks/`, `lib/`, `stores/`) and exits non-zero if any source file lacks a matching test. It runs in CI as part of the lint job (see `.github/workflows/ci.yml`).

The mirroring rule: `src/client/components/Foo.tsx` is satisfied by `tests/client/components/Foo.test.tsx`, `Foo.test.ts`, or any `Foo.<descriptor>.test.{ts,tsx}` (so `RoomView.starPlacement.test.tsx` covers `RoomView.tsx`).

When you start a new feature under one of those folders, the TDD loop is: create the test file first (`bun run test:missing` should now stay green for that path because the test exists), watch it fail (`bun run test`), then write the source file. Server-side code (`src/server/**`) is not scanned because tests there group across files (e.g. `routes/jarsAndNotes.test.ts` covers multiple route modules) — TDD still applies, but the gate would produce false positives.

### Planning

Before starting any non-trivial feature, create a plan file in the `plans/` directory. Plans are **not committed to source control** (gitignored). They exist to align on approach before writing code.

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Express + Socket.io (Bun runtime)
- **Database**: PostgreSQL (structured data) + Redis (ephemeral room state)
- **Real-time**: Socket.io (self-hosted) with Redis adapter
- **Auth**: better-auth (Google + Discord OAuth, cookie-based sessions)
- **Drag-and-drop**: @use-gesture/react + @react-spring/web
- **State management**: Zustand (roomStore + noteStore)
- **Language**: TypeScript throughout
- **Package manager**: Bun
- **Testing**: Vitest for unit + integration; Playwright for e2e (multi-browser-context for multi-user flows)
- **Linting/Formatting**: Biome (noExcessiveCognitiveComplexity enabled)
- **Dead-code scan**: knip (configured via `knip.json` — run `bun run knip` before deleting/moving code to catch orphaned exports and dependencies)

## Project Structure

```
cookie-jar/
  plans/                    # Feature plans (gitignored)
  scripts/                  # Ops scripts (migration safety check)
  src/
    client/
      components/           # React components
      hooks/                # useSocket, useDragNote, useReducedMotion, hitTest
      lib/                  # auth-client, sounds
      stores/               # Zustand stores (roomStore, noteStore)
    server/
      auth.ts               # better-auth config
      logger.ts             # pino logger (NDJSON in prod/test, pretty in dev)
      shutdown.ts           # SIGTERM/SIGINT graceful drain
      db/
        pool.ts              # Postgres pool + tunables + withTransaction
        schema.sql           # PostgreSQL bootstrap schema
        migrations/          # node-pg-migrate up/down SQL
        queries/             # Parameterized query modules
        seed-templates.ts    # Template seed script
        transaction.ts       # withTransaction helper + Queryable type
      middleware/            # requireAuth, helmet, rateLimit, compression, static
      routes/               # REST API (jars, notes, rooms, health)
      socket/               # Socket.io handlers, Redis-backed stores, auth middleware
    shared/
      types.ts              # Shared TS types
      constants.ts          # Abuse caps + configurable limits
      validation.ts         # Shared validation
      throttle.ts           # Shared throttle helper (cursor/drag emitters)
  tests/
    client/ server/ shared/  # Vitest — mirrors src structure
    e2e/                     # Playwright — multi-user flows, visual checks
    load/                    # k6 scripts (not run in CI — manual baselines)
    scripts/                 # Tests for ops scripts
```

## Key Architectural Decisions

- **Server-authoritative**: Server owns all jar/note/room state. Client is optimistic only for animations and cursor positions.
- **Asset-driven customization**: All visual/audio customization is data-driven configs pointing to asset URLs, never code branches.
- **Configurable limits**: Room size, idle timeout, note visibility — all per-jar config, not hardcoded. Abuse caps (`MAX_NOTES_PER_JAR`, `MAX_BULK_IMPORT`) are enforced server-side on both REST and socket paths.
- **Anonymous = view-only** (prod): Unauthenticated users can see rooms but cannot interact. Auth required for mutations.
- **Socket security**: `io.use()` middleware verifies session cookies on handshake. Role-based access (owner > contributor > viewer). Dedup enforced per userId per room — a second tab for the same authed user kicks the first, **cluster-wide via Redis + pub/sub** (see `dedupStore` + `kickBus`).
- **Redis-backed socket state**: Sealed notes (`sealedNotesStore`), user dedup (`dedupStore`), and room presence (`presenceStore`) all live in Redis so `room:state` is identical on every pod. Constructed once in `buildSocketServer` and threaded through handlers via the `SocketDeps` interface.
- **Idle timeout is cluster-aware**: Each pod runs its own local `setTimeout` for rooms it has members in. When the timer fires, we check a Redis `room:{id}:alive` key (refreshed on activity from *any* pod) and only close if it's expired, gated by a `SET NX EX` lock so exactly one pod fires the close.
- **Lock = read-mostly**: `room:lock` blocks `note:add` and `note:discard` for everyone (including the owner). `note:pull` and `note:return` stay allowed. Only the owner can lock/unlock.
- **Jars are images**: A jar references two image URLs (opened/closed) stored on `JarAppearance`. A hand-drawn default SVG is shown when no custom art is set. Procedural Web Audio (additive bell + filtered noise) serves as default sounds; per-jar sound packs (URLs on `JarAppearance.soundPack`) override. The client sanitizes inputs server-side via `sanitizeJarAppearance` (http(s) URLs only) but the system doesn't host uploads itself — asset URLs come from wherever the owner has them published.
- **Per-socket rate limiting**: Token-bucket in Redis-adjacent memory (not cluster-shared yet) — `note:add` 2/s burst 5, `note:pull` 1/s burst 3, `jar:refresh` 1/3s, etc. Violations emit the `rate_limited` event. Volatile high-frequency events (`cursor:move`, `note:drag`) are throttled client-side + server-marked volatile.
- **Dev auth**: `better-auth`'s anonymous plugin is registered only when `NODE_ENV === "development"` or `NODE_ENV === "test"` — any other value (including unset, `"production"`, `"staging"`, or custom names) fails closed so a misconfigured deploy can't accidentally expose anonymous sign-in. Same rule gates the dev-secret fallback in `resolveAuthSecret()`: `BETTER_AUTH_SECRET` must be set when `NODE_ENV` is anything other than explicit `development`/`test`. The client's "Continue anonymously" button is gated on `import.meta.env.DEV`. Use it for local flows without OAuth credentials.

## Commands

```bash
bun install              # Install dependencies
bun run dev              # Start client + server concurrently
bun run dev:client       # Start Vite dev server only
bun run dev:server       # Start Express server only (with watch)
bun run test             # Vitest in watch mode
bun run test:run         # Vitest once (excludes the Lighthouse suite)
bun run test:missing     # Fail if any client/{components,hooks,lib,stores} source file lacks a mirrored test (CI gate)
bun run test:lighthouse  # Sandboxed Lighthouse audit — fails if any category < 0.9 (requires Docker)
bun run e2e              # Playwright e2e (reuses running dev server locally)
bun run e2e:ui           # Playwright UI mode
bun run e2e:headed       # Watch the tests drive the browser
bun run lint             # Check linting + formatting
bun run lint:fix         # Auto-fix lint + format issues
bun run knip             # Find unused files, exports, dependencies
bun run db:up            # Start PostgreSQL + Redis (Docker)
bun run db:down          # Stop PostgreSQL + Redis
bun run db:seed          # Seed template jars
bun run db:migrate:up    # Apply pending DB migrations
bun run db:migrate:down  # Revert the most recent migration
bun run db:migrate:redo  # Down + up (test a migration's round-trip)
bun run db:migrate:create -- <name>  # Scaffold a new migration file
bun run db:migrate:check # Scan pending migrations for destructive SQL
bun run loadtest:cursors # k6: 500 VUs × 10 rooms cursor traffic
```

## Database migrations

`src/server/db/schema.sql` is the bootstrap schema for fresh local/CI databases — it gets loaded when Postgres first starts in Docker. Any schema changes *after* bootstrap go through `node-pg-migrate`:

1. `bun run db:migrate:create -- <short-name>` scaffolds a timestamped SQL migration in `src/server/db/migrations/`.
2. Fill in the `-- Up Migration` and `-- Down Migration` sections with idempotent SQL (`CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, etc.).
3. Also mirror the change into `schema.sql` so a fresh setup converges to the same state without needing to replay every migration.
4. `bun run db:migrate:up` applies it; the `pgmigrations` table tracks what's been run.

`.env` is loaded automatically via `dotenv-cli`, so `DATABASE_URL` doesn't need to be exported.

### Rollout pattern: expand → deploy → contract

When a schema change would break code that's still running, split it across two releases:

1. **Expand** — add the new shape (new column/table, new index) and deploy app code that can use either shape. `CREATE ...` and `ADD COLUMN IF NOT EXISTS` are safe to ship together with the corresponding code.
2. **Contract** — once the expanded release is fully rolled out and no traffic hits the old shape, a *separate* release drops the old column/table/index.

`bun run db:migrate:check` statically scans pending migrations for destructive SQL (`DROP TABLE`, `DROP COLUMN`, `ALTER ... TYPE`, `TRUNCATE`, etc.) and refuses to proceed without `ALLOW_DESTRUCTIVE_MIGRATION=1`. Run it in CI before `db:migrate:up` when deploying to shared environments.

## Path Aliases

- `@shared/*` maps to `src/shared/*` — use for importing shared types and constants from both client and server code.

## Auth Setup

Prod uses Google + Discord OAuth; credentials go in `.env` (gitignored). See `.env.example`. For local dev, click **Continue anonymously (dev)** on the landing screen — no credentials needed. That flow creates a real better-auth session using the anonymous plugin, which is only registered when `NODE_ENV === "development"` or `NODE_ENV === "test"` (server) AND `import.meta.env.DEV` (client). An unset `NODE_ENV` in a hosted environment *does not* enable the anon plugin — the gating fails closed on ambiguity.

## Socket Events

Client → Server: `room:join`, `room:leave`, `cursor:move`, `note:add`, `note:pull`, `note:discard`, `note:return`, `note:returnAll`, `note:discardAll`, `note:drag`, `note:drag_end`, `history:get`, `history:clear`, `jar:refresh`

Server → Client: `room:state`, `room:member_joined`, `room:member_left`, `room:error`, `cursor:moved`, `note:state`, `note:added`, `note:pulled`, `note:discarded`, `note:returned`, `note:updated`, `note:sealed`, `note:reveal`, `note:drag`, `note:drag_end`, `pull:rejected`, `history:list`, `rate_limited`, `auth:expired`

The dedicated `room:lock` / `room:unlock` events (and their `room:locked` / `room:unlocked` counterparts) have been retired — lock state is a `jarConfig.locked` field toggled via `PATCH /api/jars/:id` + `jar:refresh`.

`jar:refresh` is emitted by the owner after a REST PATCH to `/api/jars/:id`. The server now broadcasts a *compact* `note:state` (config + appearance + counts, **not** the full pulled-notes array) so a 50-user room doesn't eat 1 MB of fanout on a config tweak. Clients preserve their existing pulled notes when `pulledNotes` is absent. `note:drag` / `note:drag_end` are volatile relays for mirroring active drags to peers — no DB writes. `rate_limited` fires when a socket exceeds its per-event budget. `auth:expired` fires just before the server disconnects a socket whose underlying session has expired.

## Env vars

Runtime config is read from `.env` (dev) or the platform's env (prod). Non-obvious ones:

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | local compose | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis (adapter + state + rate limit + idle) |
| `CLIENT_URL` | `http://localhost:5173` | CORS + OAuth trusted origin (Vite default) |
| `PORT` | `3001` | HTTP server port |
| `NODE_ENV` | — | `production` enables strict mode: anon plugin off, logger NDJSON, `BETTER_AUTH_SECRET` required |
| `BETTER_AUTH_SECRET` | dev-only | Session signing secret; required in prod |
| `SHUTDOWN_GRACE_MS` | `10000` | Max time to drain on SIGTERM before force-exit |
| `LOG_LEVEL` | `info` (prod) / `debug` (dev) | pino level |
| `PG_POOL_MAX` | `20` | Max Postgres connections |
| `PG_IDLE_TIMEOUT_MS` | `30000` | Close idle DB connections after this |
| `PG_CONNECTION_TIMEOUT_MS` | `5000` | Fail fast on slow DB |
| `PG_STATEMENT_TIMEOUT_MS` | `10000` | Kill queries exceeding this |
| `ALLOW_DESTRUCTIVE_MIGRATION` | — | Set to `1` to bypass `db:migrate:check` refusing destructive SQL |
| `SOCKET_IP_CONN_LIMIT` | `50` | Max concurrent socket connections per IP per pod — handshake DoS backstop |
