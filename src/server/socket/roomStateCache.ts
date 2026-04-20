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

export interface RoomStateCache {
  getLocked(roomId: string): Promise<boolean>;
  getJar(jarId: string): Promise<{ config: JarConfig | null; appearance: JarAppearance | null }>;
  invalidateRoom(roomId: string): void;
  invalidateJar(jarId: string): void;
  setLocked(roomId: string, locked: boolean): void;
}

export function createRoomStateCache(
  pool: pg.Pool,
  ttlMs: number = DEFAULT_TTL_MS,
): RoomStateCache {
  const locks = new Map<string, LockEntry>();
  const jars = new Map<string, JarEntry>();

  return {
    async getLocked(roomId) {
      const now = Date.now();
      const cached = locks.get(roomId);
      if (cached && cached.expires > now) return cached.locked;
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
  };
}
