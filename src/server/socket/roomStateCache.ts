import type { Jar, JarAppearance, JarConfig } from "@shared/types";
import type pg from "pg";
import * as jarQueries from "../db/queries/jars";

/**
 * Per-pod TTL cache for the jar reads on the socket hot paths. Lock state
 * lives inside `jarConfig.locked` so it reads from the same entry — no
 * separate lock cache.
 *
 * Covers:
 *   - note:add / note:pull / note:discard config+lock lookups (via getJar)
 *   - room:join full-jar lookup (via getFullJar) so we skip a DB round-trip
 *     per room:join when the jar is warm in cache
 *
 * A short TTL means we at most stale the value for `ttlMs` across pods;
 * `jar:refresh` explicitly invalidates locally, so single-pod correctness
 * is immediate. Eviction is "lazy on read miss" + periodic sweep so entries
 * for closed rooms don't accumulate.
 */

interface JarEntry {
  jar: Jar | null;
  expires: number;
}

const DEFAULT_TTL_MS = 5_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export interface RoomStateCache {
  /** Narrow view: config + appearance. Used by note-write handlers. */
  getJar(jarId: string): Promise<{ config: JarConfig | null; appearance: JarAppearance | null }>;
  /** Full jar row (or null if missing). Used by room:join. */
  getFullJar(jarId: string): Promise<Jar | null>;
  invalidateJar(jarId: string): void;
  /** Stop the internal sweep timer. Call during graceful shutdown. */
  stop(): void;
}

interface RoomStateCacheOptions {
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

  async function loadIntoCache(jarId: string): Promise<JarEntry> {
    const jar = await jarQueries.getJarById(pool, jarId);
    const entry: JarEntry = { jar: jar ?? null, expires: Date.now() + ttlMs };
    jars.set(jarId, entry);
    return entry;
  }

  async function readEntry(jarId: string): Promise<JarEntry> {
    const cached = jars.get(jarId);
    if (cached && cached.expires > Date.now()) return cached;
    if (cached) jars.delete(jarId);
    return loadIntoCache(jarId);
  }

  return {
    async getJar(jarId) {
      const { jar } = await readEntry(jarId);
      return { config: jar?.config ?? null, appearance: jar?.appearance ?? null };
    },

    async getFullJar(jarId) {
      const { jar } = await readEntry(jarId);
      return jar;
    },

    invalidateJar(jarId) {
      jars.delete(jarId);
    },

    stop() {
      if (sweepHandle) clearInterval(sweepHandle);
    },
  };
}
