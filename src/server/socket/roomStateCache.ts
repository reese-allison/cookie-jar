import type { JarAppearance, JarConfig } from "@shared/types";
import type pg from "pg";
import * as jarQueries from "../db/queries/jars";
import * as roomQueries from "../db/queries/rooms";

/**
 * Per-pod TTL cache for the two bits of room/jar state read on the note-write
 * hot path: whether the room is locked, and the jar's visibility config.
 *
 * Without this, `note:add`/`note:pull`/`note:discard` each run a DB round-trip
 * to check lock state + jar config. A short TTL means we at most stale the
 * value for `ttlMs` across pods; lock/unlock and `jar:refresh` explicitly
 * invalidate locally, so single-pod correctness is immediate.
 *
 * Eviction is "sweep on read miss" plus a periodic sweep on an interval —
 * without this, entries for closed rooms would accumulate forever.
 */

interface LockEntry {
  locked: boolean;
  expires: number;
}
interface JarEntry {
  config: JarConfig | null;
  appearance: JarAppearance | null;
  expires: number;
}

const DEFAULT_TTL_MS = 5_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export interface RoomStateCache {
  getLocked(roomId: string): Promise<boolean>;
  getJar(jarId: string): Promise<{ config: JarConfig | null; appearance: JarAppearance | null }>;
  invalidateRoom(roomId: string): void;
  invalidateJar(jarId: string): void;
  setLocked(roomId: string, locked: boolean): void;
  /** Stop the internal sweep timer. Call during graceful shutdown. */
  stop(): void;
}

export interface RoomStateCacheOptions {
  ttlMs?: number;
  sweepIntervalMs?: number;
  /** Start the sweep timer. Default true; tests pass false to avoid leaked handles. */
  autoSweep?: boolean;
}

export function createRoomStateCache(
  pool: pg.Pool,
  opts: RoomStateCacheOptions = {},
): RoomStateCache {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const locks = new Map<string, LockEntry>();
  const jars = new Map<string, JarEntry>();

  function sweep(): void {
    const now = Date.now();
    for (const [k, v] of locks) if (v.expires <= now) locks.delete(k);
    for (const [k, v] of jars) if (v.expires <= now) jars.delete(k);
  }

  let sweepHandle: ReturnType<typeof setInterval> | null = null;
  if (opts.autoSweep !== false) {
    sweepHandle = setInterval(sweep, sweepIntervalMs);
    // Don't keep the event loop alive just for the sweep timer.
    sweepHandle.unref?.();
  }

  return {
    async getLocked(roomId) {
      const now = Date.now();
      const cached = locks.get(roomId);
      if (cached && cached.expires > now) return cached.locked;
      // Drop stale entry before fetching so a never-re-read room doesn't leak.
      if (cached) locks.delete(roomId);
      const room = await roomQueries.getRoomById(pool, roomId);
      const locked = room?.state === "locked";
      locks.set(roomId, { locked, expires: now + ttlMs });
      return locked;
    },

    async getJar(jarId) {
      const now = Date.now();
      const cached = jars.get(jarId);
      if (cached && cached.expires > now) {
        return { config: cached.config, appearance: cached.appearance };
      }
      if (cached) jars.delete(jarId);
      const jar = await jarQueries.getJarById(pool, jarId);
      const entry: JarEntry = {
        config: jar?.config ?? null,
        appearance: jar?.appearance ?? null,
        expires: now + ttlMs,
      };
      jars.set(jarId, entry);
      return { config: entry.config, appearance: entry.appearance };
    },

    invalidateRoom(roomId) {
      locks.delete(roomId);
    },

    invalidateJar(jarId) {
      jars.delete(jarId);
    },

    setLocked(roomId, locked) {
      // Called immediately after a lock/unlock so other events on this pod see
      // the new value without waiting for the TTL to tick or re-fetching.
      locks.set(roomId, { locked, expires: Date.now() + ttlMs });
    },

    stop() {
      if (sweepHandle) clearInterval(sweepHandle);
    },
  };
}
