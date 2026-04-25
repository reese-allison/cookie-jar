# Cookie Jar

[![CI](https://github.com/reese-allison/cookie-jar/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/reese-allison/cookie-jar/actions/workflows/ci.yml?query=branch%3Amain)

A real-time collaborative web app where groups share a virtual jar of
user-created notes and pull them out at random. Jackbox-style room
codes, live cursors, tactile drag-and-drop.

**Live**: <https://the-cookie-jar.fly.dev>

## What it does

- Owners create a **jar** (a persistent collection of notes) and start a **room** with a shareable 6-character code.
- Anyone with the code joins the room. Members write notes, throw them into the jar, and pull random notes back out.
- Every action is real-time: live cursors, optimistic drag animations, socket-driven state sync.
- Jars are fully customizable — the owner points at an image URL for the jar's look (opened/closed states) and optionally a sound pack. No jar templates locked into the UI; bring your own art.
- Access control: jars default to private (join-with-code), can be flipped to public or template. Email / user-id allowlists turn a jar into invite-only.

## Tech stack

- **Frontend**: React + Vite, Zustand, @use-gesture + @react-spring for drag-and-drop
- **Backend**: Express + Socket.io on Bun
- **Database**: PostgreSQL (durable state) + Redis (socket adapter + cluster-scoped presence/dedup/sealed-notes)
- **Auth**: better-auth with Google + Discord OAuth (cookie sessions); anonymous dev sign-in in development only
- **Testing**: Vitest (unit + integration) + Playwright (multi-browser-context e2e)
- **Deploy**: Fly.io single-Machine ([runbook](DEPLOY.md))

See [`CLAUDE.md`](CLAUDE.md) for the detailed architecture notes.

## Local development

Requires [Bun](https://bun.sh/) and Docker.

```bash
bun install
bun run db:up         # Postgres + Redis via docker-compose
bun run db:migrate:up # apply migrations
bun run dev           # Vite client (:5173) + Express server (:3001)
```

Open <http://localhost:5173>. On the landing screen click **Continue
anonymously (dev)** to get a session without configuring OAuth — the
anon plugin is enabled only when `NODE_ENV` is `development` or `test`.

### Other commands

| | |
|---|---|
| `bun run build` | Production build (typechecks server + client, bundles client) |
| `bun run test` | Vitest watch mode |
| `bun run test:run` | Vitest once (excludes the Lighthouse suite) |
| `bun run test:missing` | Coverage gate — fails if any source file under `components/`, `hooks/`, `lib/`, or `stores/` lacks a mirrored test |
| `bun run test:lighthouse` | Sandboxed Lighthouse audit — fails if any category drops below the green threshold (requires Docker) |
| `bun run e2e` | Playwright e2e (auto-uses the running dev server) |
| `bun run lint` | Biome check (lint + format) |
| `bun run lint:fix` | Biome auto-fix |
| `bun run knip` | Dead-code / unused-dependency scan |
| `bun run loadtest:cursors` | k6 cursor-traffic scenario (requires k6 installed) |
| `bun tests/load/bench.ts --rooms 50 --per-room 5` | Bun-based realtime bench (no k6 needed) |

## CI

GitHub Actions runs the full quality suite on every push to `main`
and every pull request (`.github/workflows/ci.yml`). The workflow
fans out into four parallel jobs:

| Job | Runs |
|---|---|
| **Lint** | `bun run lint` (Biome — lint + format), `bun run knip` (dead-code/unused-deps scan), `bun run test:missing` (coverage gate — fails the build if any source file under `components/`, `hooks/`, `lib/`, or `stores/` lacks a mirrored test) |
| **Build** | `bun run build` (server + shared via `tsc -b`, client via `vite build`) |
| **Vitest** | `bun run test:run` against ephemeral Postgres + Redis service containers |
| **Lighthouse** | `bun run test:lighthouse` — builds `Dockerfile.lighthouse` and runs the audit inside a pinned-Chromium sandbox; fails if any category scores below 0.9 |

In-progress runs for the same ref are cancelled when new commits land,
so a PR force-push doesn't leave stale runs queued.

## Limits

Hard caps enforced server-side on both REST and socket paths:

- **1000** notes per jar
- **500** characters per note text
- **2000** characters per note URL (http/https only)
- **500** notes per bulk-import request
- **5000** rows per export

All configurable in `src/shared/constants.ts`.

## Deploying

See [DEPLOY.md](DEPLOY.md) for the Fly.io deploy runbook. Target cost:
~$6/mo (shared-cpu-1x@512MB app + Fly Postgres dev tier + Upstash Redis
free tier).

## Project structure

High-level layout; [`CLAUDE.md`](CLAUDE.md) has the full breakdown.

```
cookie-jar/
├─ src/
│  ├─ client/      React + Vite frontend
│  ├─ server/      Express + Socket.io backend
│  └─ shared/      Types, constants, validation
├─ tests/          Vitest + Playwright
├─ scripts/        Ops (migrations bootstrap, etc.)
├─ Dockerfile      Multi-stage build (bun base + node installed for migrations)
├─ fly.toml        Fly.io deploy config
├─ CLAUDE.md       Architecture + conventions
└─ DEPLOY.md       Fly.io deploy runbook
```
