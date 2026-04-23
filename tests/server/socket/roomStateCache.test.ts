import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoomStateCache } from "../../../src/server/socket/roomStateCache";

// Minimal pg.Pool stub — we control the return values of getJarById via
// mocked query() responses. Only the shapes the jar query reads from are
// populated. Lock state no longer lives in the cache; it's a JarConfig field.
function makePool(jarRows: Array<Record<string, unknown>>): pg.Pool {
  const query = vi.fn(async (sql: string) => {
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

  it("caches jar config across calls", async () => {
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
    const pool = makePool([jarRow]);
    const cache = createRoomStateCache(pool, { autoSweep: false });
    await cache.getJar("j1");
    await cache.getJar("j1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    cache.stop();
  });

  it("re-fetches after ttlMs expires and drops the stale entry", async () => {
    const jarRow = {
      id: "j1",
      owner_id: "u1",
      name: "test",
      appearance: {},
      config: { noteVisibility: "open" },
      is_template: false,
      is_public: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const pool = makePool([jarRow]);
    const cache = createRoomStateCache(pool, { ttlMs: 1000, autoSweep: false });
    await cache.getJar("j1");
    vi.advanceTimersByTime(1500);
    await cache.getJar("j1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    cache.stop();
  });

  it("invalidateJar forces the next read to hit the DB", async () => {
    const jarRow = {
      id: "j1",
      owner_id: "u1",
      name: "test",
      appearance: {},
      config: { noteVisibility: "open", locked: true },
      is_template: false,
      is_public: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const pool = makePool([jarRow]);
    const cache = createRoomStateCache(pool, { autoSweep: false });
    await cache.getJar("j1");
    cache.invalidateJar("j1");
    await cache.getJar("j1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    cache.stop();
  });

  it("getFullJar returns the full cached row, sharing cache with getJar", async () => {
    // Hitting getJar first warms the cache; getFullJar must reuse that entry
    // instead of triggering a second DB round-trip. Saves 1 query per room:join.
    const jarRow = {
      id: "j1",
      owner_id: "u1",
      name: "Full Jar",
      appearance: {},
      config: { noteVisibility: "open" },
      is_template: false,
      is_public: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const pool = makePool([jarRow]);
    const cache = createRoomStateCache(pool, { autoSweep: false });
    await cache.getJar("j1");
    const full = await cache.getFullJar("j1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(full?.ownerId).toBe("u1");
    expect(full?.name).toBe("Full Jar");
    cache.stop();
  });

  it("getFullJar returns null when the jar doesn't exist", async () => {
    const pool = makePool([]);
    const cache = createRoomStateCache(pool, { autoSweep: false });
    expect(await cache.getFullJar("missing")).toBeNull();
    cache.stop();
  });

  it("sweep drops expired entries so long-dead jars don't leak", async () => {
    const jarRow = {
      id: "j1",
      owner_id: "u1",
      name: "test",
      appearance: {},
      config: { noteVisibility: "open" },
      is_template: false,
      is_public: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const pool = makePool([jarRow]);
    const cache = createRoomStateCache(pool, {
      ttlMs: 100,
      sweepIntervalMs: 200,
    });
    await cache.getJar("j1");
    vi.advanceTimersByTime(500);
    await cache.getJar("j1");
    expect(pool.query as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    cache.stop();
  });
});
