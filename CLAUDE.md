# Cookie Jar

A real-time collaborative web app where groups share a virtual jar of user-created notes and pull them out at random. Jackbox-style room codes, live cursors, tactile drag-and-drop interactions.

## Development Philosophy

### Test-Driven Development (TDD)

**All new features must follow TDD.** The workflow is:

1. Write failing tests first that describe the desired behavior
2. Write the minimum code to make the tests pass
3. Refactor while keeping tests green

No feature code should be written without a corresponding test written beforehand. This applies to backend logic, API routes, real-time event handlers, and frontend component behavior.

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
- **Testing**: Vitest (117 tests, 22 files)
- **Linting/Formatting**: Biome (noExcessiveCognitiveComplexity enabled)

## Project Structure

```
cookie-jar/
  plans/                    # Feature plans (gitignored)
  public/uploads/           # User uploads (gitignored)
  src/
    client/
      components/           # React components
      hooks/                # useSocket, useDragNote, hitTest
      lib/                  # auth-client, sounds
      stores/               # Zustand stores (roomStore, noteStore)
    server/
      auth.ts               # better-auth config
      db/
        schema.sql           # PostgreSQL schema
        queries/             # Parameterized query modules
        seed-templates.ts    # Template seed script
      middleware/            # requireAuth
      routes/               # REST API (jars, notes, rooms, uploads)
      socket/               # Socket.io handlers, auth middleware, idle timeout
    shared/
      types.ts              # Shared TS types
      constants.ts          # Configurable limits
      validation.ts         # Shared validation
  tests/                    # Test files mirroring src structure
```

## Key Architectural Decisions

- **Server-authoritative**: Server owns all jar/note/room state. Client is optimistic only for animations and cursor positions.
- **Asset-driven customization**: All visual/audio customization is data-driven configs pointing to asset URLs, never code branches.
- **Configurable limits**: Room size, idle timeout, note visibility — all per-jar config, not hardcoded.
- **Anonymous = view-only**: Unauthenticated users can see rooms but cannot interact. Auth required for all mutations.
- **Socket security**: io.use() middleware verifies session cookies on handshake. Role-based access (owner > contributor > viewer).
- **Jars are images**: A jar is two user-uploaded images (opened/closed state) — no predefined shapes. Procedural sounds as defaults with per-jar custom sound packs.

## Commands

```bash
bun install              # Install dependencies
bun run dev              # Start client + server concurrently
bun run dev:client       # Start Vite dev server only
bun run dev:server       # Start Express server only (with watch)
bun run test             # Run tests in watch mode
bun run test:run         # Run tests once
bun run lint             # Check linting + formatting
bun run lint:fix         # Auto-fix lint + format issues
bun run db:up            # Start PostgreSQL + Redis (Docker)
bun run db:down          # Stop PostgreSQL + Redis
bun run db:seed          # Seed template jars
```

## Path Aliases

- `@shared/*` maps to `src/shared/*` — use for importing shared types and constants from both client and server code.

## Auth Setup

OAuth requires Google and Discord app credentials. See `plans/oauth-credentials-setup.md` for the guide. Credentials go in `.env` (gitignored). See `.env.example` for the template.

## Socket Events

Client → Server: `room:join`, `room:leave`, `room:lock`, `room:unlock`, `cursor:move`, `note:add`, `note:pull`, `note:discard`, `note:return`, `history:get`, `history:clear`

Server → Client: `room:state`, `room:member_joined`, `room:member_left`, `room:locked`, `room:unlocked`, `room:error`, `cursor:moved`, `note:state`, `note:added`, `note:pulled`, `note:discarded`, `note:returned`, `note:sealed`, `note:reveal`, `pull:rejected`, `history:list`
