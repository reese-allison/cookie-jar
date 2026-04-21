import type { JarAppearance, JarConfig } from "@shared/types";
import type pg from "pg";
import * as jarQueries from "../db/queries/jars";

/**
 * Per-pod TTL cache for the jar config + appearance reads on the note-write
 * hot path. Lock state now lives inside `jarConfig.locked` so it reads from
 * the same entry — no separate lock cache.
 *
 * Without this, `note:add`/`note:pull`/`note:discard` each run a DB round-trip
 * to check lock state + jar config. A short TTL means we at most stale the
 * value for `ttlMs` across pods; `jar:refresh` explicitly invalidates
 * locally, so single-pod correctness is immediate.
 *
 * Eviction is "sweep on read miss" plus a periodic sweep on an interval —
 * without this, entries for closed rooms would accumulate forever.
 */

interface JarEntry {
  config: JarConfig | null;
  appearance: JarAppearance | null;
  expires: number;
}

const DEFAULT_TTL_MS = 5_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export interface RoomStateCache {
  getJar(jarId: string): Promise<{ config: JarConfig | null; appearance: JarAppearance | null }>;
  invalidateJar(jarId: string): void;
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
  const jars = new Map<string, JarEntry>();

  function sweep(): void {
    const now = Date.now();
    for (const [k, v] of jars) if (v.expires <= now) jars.delete(k);
  }

  let sweepHandle: ReturnType<typeof setInterval> | null = null;
  if (opts.autoSweep !== false) {
    sweepHandle = setInterval(sweep, sweepIntervalMs);
    // Don't keep the event loop alive just for the sweep timer.
    sweepHandle.unref?.();
  }

  return {
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

    invalidateJar(jarId) {
      jars.delete(jarId);
    },

    stop() {
      if (sweepHandle) clearInterval(sweepHandle);
    },
  };
}
