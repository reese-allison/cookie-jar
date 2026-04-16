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
- **Language**: TypeScript throughout
- **Package manager**: Bun
- **Testing**: Vitest
- **Linting/Formatting**: Biome

## Project Structure

```
cookie-jar/
  plans/           # Feature plans (gitignored)
  src/
    client/        # React frontend
    server/        # Backend API + WebSocket
    shared/        # Shared types and constants
  tests/           # Test files mirroring src structure
```

## Key Architectural Decisions

- **Server-authoritative**: Server owns all jar/note/room state. Client is optimistic only for animations and cursor positions.
- **Asset-driven customization**: All visual/audio customization is data-driven configs pointing to asset URLs, never code branches. This supports the monetization tier system.
- **Configurable limits**: Room size, jar capacity, note styles, sound packs — all driven by user tier config, not hardcoded values.

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start client + server concurrently
bun run dev:client   # Start Vite dev server only
bun run dev:server   # Start Express server only (with watch)
bun run test         # Run tests in watch mode
bun run test:run     # Run tests once
bun run lint         # Check linting + formatting
bun run lint:fix     # Auto-fix lint + format issues
bun run db:up        # Start PostgreSQL + Redis (Docker)
bun run db:down      # Stop PostgreSQL + Redis
```

## Path Aliases

- `@shared/*` maps to `src/shared/*` — use for importing shared types and constants from both client and server code.
