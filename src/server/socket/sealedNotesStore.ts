import type { Note } from "@shared/types";
import type { Redis } from "ioredis";

export interface SealedNotesStore {
  /** Append a note to the room's sealed buffer. Returns the new buffer length. */
  push(roomId: string, note: Note): Promise<number>;
  /**
   * If the buffer has >= `threshold` notes, atomically reads + clears it and
   * returns the notes (this pod "wins" the reveal). Otherwise returns an empty
   * array and leaves the buffer untouched (another pod is waiting for more,
   * or nobody's at the threshold yet).
   */
  revealIfReady(roomId: string, threshold: number): Promise<Note[]>;
  /**
   * Drain the buffer unconditionally (returns all entries + clears). Used when
   * the owner flips the jar out of sealed mode mid-batch — otherwise the
   * queued notes would never surface.
   */
  drain(roomId: string): Promise<Note[]>;
  /**
   * Remove a specific note id from the buffer. Used when a note is discarded
   * before the reveal threshold fires — otherwise the discarded note would
   * materialize on the table when the buffer eventually reveals.
   */
  remove(roomId: string, noteId: string): Promise<void>;
  /**
   * Replace the buffered snapshot for a given note id in-place. Used when the
   * owner edits a pulled note's text via REST — the buffer holds the old
   * serialized blob, so without this the note would reveal with stale text.
   * Silent no-op when the note isn't in the buffer.
   */
  updateInBuffer(roomId: string, note: Note): Promise<void>;
  /** Current buffer length. Used to decide whether to auto-reveal on config changes. */
  length(roomId: string): Promise<number>;
  /** Unconditionally clear the buffer. Used on room close / owner clear. */
  clear(roomId: string): Promise<void>;
}

// Redis list per room. TTL so buffers don't linger forever when a reveal never
// happens (e.g. owner leaves mid-session). Refreshed on every push so active
// rooms stay alive.
const KEY_PREFIX = "room:";
const KEY_SUFFIX = ":sealed";
const DEFAULT_TTL_SECONDS = 60 * 60 * 6; // 6 hours
const COMMAND_NAME = "cookieJarSealedReveal";

function key(roomId: string): string {
  return `${KEY_PREFIX}${roomId}${KEY_SUFFIX}`;
}

/**
 * Atomic "reveal if ready" — checks length, returns + deletes only if at
 * threshold. Without this Lua script, two pods checking LLEN + DEL could both
 * try to emit the reveal; with it, only the pod that executes the Lua wins.
 */
const REVEAL_IF_READY_LUA = `
local len = redis.call('LLEN', KEYS[1])
if len >= tonumber(ARGV[1]) then
  local items = redis.call('LRANGE', KEYS[1], 0, -1)
  redis.call('DEL', KEYS[1])
  return items
end
return {}
`;

const registered = new WeakSet<Redis>();

function ensureRegistered(redis: Redis): void {
  if (registered.has(redis)) return;
  redis.defineCommand(COMMAND_NAME, { numberOfKeys: 1, lua: REVEAL_IF_READY_LUA });
  registered.add(redis);
}

type WithRevealCommand = Redis & {
  [COMMAND_NAME](key: string, threshold: string): Promise<string[]>;
};

export function createSealedNotesStore(
  redis: Redis,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): SealedNotesStore {
  ensureRegistered(redis);
  const client = redis as WithRevealCommand;

  return {
    async push(roomId, note) {
      const k = key(roomId);
      // Pipeline so a crash between rpush and expire can't leave a TTL-less
      // key sitting in Redis forever. Both commands ship in one round-trip.
      const results = await redis
        .multi()
        .rpush(k, JSON.stringify(note))
        .expire(k, ttlSeconds)
        .exec();
      const rpushResult = results?.[0];
      if (!rpushResult || rpushResult[0]) {
        // Either the pipeline didn't return (connection issue) or rpush itself
        // errored. Fall through with a best-effort length query.
        return redis.llen(k);
      }
      return rpushResult[1] as number;
    },

    async revealIfReady(roomId, threshold) {
      const raw = await client[COMMAND_NAME](key(roomId), String(threshold));
      return raw.map((s) => JSON.parse(s) as Note);
    },

    async drain(roomId) {
      const k = key(roomId);
      // LRANGE + DEL is atomic-enough for our purposes: a concurrent push on
      // another pod would land in a *new* key (we just deleted), so we might
      // return a buffer of 3 and that concurrent push starts fresh at 1.
      // Acceptable — the caller is in the jar:refresh path which only runs
      // from the owner and is rate-limited to 1 per 3s.
      const raw = await redis.lrange(k, 0, -1);
      if (raw.length > 0) await redis.del(k);
      return raw.map((s) => JSON.parse(s) as Note);
    },

    async remove(roomId, noteId) {
      const k = key(roomId);
      const raw = await redis.lrange(k, 0, -1);
      if (raw.length === 0) return;
      // LREM needs the exact serialized value to match. Find the entry whose
      // parsed id matches and remove that specific JSON string.
      for (const entry of raw) {
        try {
          const parsed = JSON.parse(entry) as Note;
          if (parsed.id === noteId) {
            await redis.lrem(k, 1, entry);
            return;
          }
        } catch {
          // Skip malformed entries — they'll be drained on next reveal.
        }
      }
    },

    async updateInBuffer(roomId, note) {
      const k = key(roomId);
      const raw = await redis.lrange(k, 0, -1);
      if (raw.length === 0) return;
      for (let i = 0; i < raw.length; i++) {
        try {
          const parsed = JSON.parse(raw[i]) as Note;
          if (parsed.id === note.id) {
            // LSET by index is O(1); no atomic LREM+RPUSH dance needed, which
            // also preserves the note's queue position — important so the
            // reveal still fires on the same threshold we were heading for.
            await redis.lset(k, i, JSON.stringify(note));
            return;
          }
        } catch {
          // Skip malformed; a future sweep will drop them.
        }
      }
    },

    async length(roomId) {
      return redis.llen(key(roomId));
    },

    async clear(roomId) {
      await redis.del(key(roomId));
    },
  };
}
