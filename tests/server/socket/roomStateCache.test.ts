import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoomStateCache } from "../../../src/server/socket/roomStateCache";

// Minimal pg.Pool stub — we control the return values of getRoomById and
// getJarById via mocked query() responses. Only the shapes these two queries
// read from are populated.
function makePool(
  roomRows: Array<Record<string, unknown>>,
  jarRows: Array<Record<string, unknown>>,
): pg.Pool {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM rooms")) return { rows: roomRows };
    if (sql.includes("FROM jars")) return { rows: jarRows };
    return { rows: [] };
  });
  return { query } as unknown as pg.Pool;
}

describe("roomStateCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads lock state from the DB on first call and caches it", async () => {
    const pool = makePool(
      [
        {
          id: "r1",
          code: "ABCDEF",
          jar_id: "j1",
          state: "open",
          max_participants: 20,
          max_viewers: 50,
          idle_timeout_minutes: 30,
          created_at: new Date(),
          closed_at: null,
        },
      ],
      [],
    );
    const cache = createRoomStateCache(pool, { autoSweep: false });
    expect(await cache.getLocked("r1")).toBe(false);
    expect(await cache.getLocked("r1")).toBe(false);
    // Two reads, one DB hit.
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    cache.stop();
  });

  it("re-fetches after ttlMs expires and drops the stale entry", async () => {
    const pool = makePool(
      [
        {
          id: "r1",
          code: "ABCDEF",
          jar_id: "j1",
          state: "open",
          max_participants: 20,
          max_viewers: 50,
          idle_timeout_minutes: 30,
          created_at: new Date(),
          closed_at: null,
        },
      ],
      [],
    );
    const cache = createRoomStateCache(pool, { ttlMs: 1000, autoSweep: false });
    await cache.getLocked("r1");
    vi.advanceTimersByTime(1500);
    await cache.getLocked("r1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    cache.stop();
  });

  it("setLocked updates cache without a DB round-trip", async () => {
    const pool = makePool([], []);
    const cache = createRoomStateCache(pool, { autoSweep: false });
    cache.setLocked("r1", true);
    expect(await cache.getLocked("r1")).toBe(true);
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    cache.stop();
  });

  it("invalidateRoom forces the next read to hit the DB", async () => {
    const pool = makePool(
      [
        {
          id: "r1",
          code: "ABCDEF",
          jar_id: "j1",
          state: "locked",
          max_participants: 20,
          max_viewers: 50,
          idle_timeout_minutes: 30,
          created_at: new Date(),
          closed_at: null,
        },
      ],
      [],
    );
    const cache = createRoomStateCache(pool, { autoSweep: false });
    await cache.getLocked("r1");
    cache.invalidateRoom("r1");
    await cache.getLocked("r1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    cache.stop();
  });

  it("sweep drops expired entries so long-dead rooms don't leak", async () => {
    const pool = makePool(
      [
        {
          id: "r1",
          code: "ABCDEF",
          jar_id: "j1",
          state: "open",
          max_participants: 20,
          max_viewers: 50,
          idle_timeout_minutes: 30,
          created_at: new Date(),
          closed_at: null,
        },
      ],
      [],
    );
    const cache = createRoomStateCache(pool, {
      ttlMs: 100,
      sweepIntervalMs: 200,
    });
    await cache.getLocked("r1");
    // Move past both TTL and sweep interval; the next sweep runs and evicts.
    vi.advanceTimersByTime(500);
    // Reading again now takes a DB hit because the cached entry was swept.
    await cache.getLocked("r1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    cache.stop();
  });

  it("caches jar config and invalidates via invalidateJar", async () => {
    const jarRow = {
      id: "j1",
      owner_id: "u1",
      name: "test",
      appearance: { label: "x" },
      config: { noteVisibility: "open" },
      is_template: false,
      is_public: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const pool = makePool([], [jarRow]);
    const cache = createRoomStateCache(pool, { autoSweep: false });
    await cache.getJar("j1");
    await cache.getJar("j1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    cache.invalidateJar("j1");
    await cache.getJar("j1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    cache.stop();
  });
});
