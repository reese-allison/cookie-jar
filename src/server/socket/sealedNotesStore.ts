import type { Note } from "@shared/types";
import type Redis from "ioredis";

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
  /** Unconditionally clear the buffer. Used on room close / owner clear. */
  clear(roomId: string): Promise<void>;
}

// Redis list per room. TTL so buffers don't linger forever when a reveal never
// happens (e.g. owner leaves mid-session). Refreshed on every push so active
// rooms stay alive.
const KEY_PREFIX = "room:";
const KEY_SUFFIX = ":sealed";
const DEFAULT_TTL_SECONDS = 60 * 60 * 6; // 6 hours

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

export function createSealedNotesStore(
  redis: Redis,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): SealedNotesStore {
  return {
    async push(roomId, note) {
      const k = key(roomId);
      const newLen = await redis.rpush(k, JSON.stringify(note));
      // Best-effort TTL refresh; if it fails we'll just have a longer-lived key.
      await redis.expire(k, ttlSeconds);
      return newLen;
    },

    async revealIfReady(roomId, threshold) {
      const raw = (await redis.eval(
        REVEAL_IF_READY_LUA,
        1,
        key(roomId),
        String(threshold),
      )) as string[];
      return raw.map((s) => JSON.parse(s) as Note);
    },

    async clear(roomId) {
      await redis.del(key(roomId));
    },
  };
}
