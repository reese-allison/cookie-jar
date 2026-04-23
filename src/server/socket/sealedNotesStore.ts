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
const PUSH_COMMAND = "cookieJarSealedPush";
const REMOVE_COMMAND = "cookieJarSealedRemove";
const UPDATE_COMMAND = "cookieJarSealedUpdate";
const DRAIN_COMMAND = "cookieJarSealedDrain";

function key(roomId: string): string {
  return `${KEY_PREFIX}${roomId}${KEY_SUFFIX}`;
}

// RPUSH + EXPIRE in one Lua — on hosted Redis (command-billed), this halves
// the cost of each sealed-mode pull.
const PUSH_LUA = `
local len = redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return len
`;

// LRANGE + LREM in one Lua: scan the buffer for the note with ARGV[1] as id
// and remove that exact serialized entry. Returns 1 if removed, 0 if absent.
const REMOVE_LUA = `
local items = redis.call('LRANGE', KEYS[1], 0, -1)
local target = ARGV[1]
for _, raw in ipairs(items) do
  local ok, obj = pcall(cjson.decode, raw)
  if ok and type(obj) == 'table' and obj.id == target then
    redis.call('LREM', KEYS[1], 1, raw)
    return 1
  end
end
return 0
`;

// LRANGE + LSET in one Lua: find the entry by note id and replace it in
// place. Returns 1 on hit, 0 if the note isn't in the buffer.
const UPDATE_LUA = `
local items = redis.call('LRANGE', KEYS[1], 0, -1)
local target = ARGV[1]
local newJson = ARGV[2]
for i, raw in ipairs(items) do
  local ok, obj = pcall(cjson.decode, raw)
  if ok and type(obj) == 'table' and obj.id == target then
    redis.call('LSET', KEYS[1], i - 1, newJson)
    return 1
  end
end
return 0
`;

// LRANGE + DEL in one Lua — used when the owner flips sealed mode off
// mid-batch. Returns the drained entries before deletion.
const DRAIN_LUA = `
local items = redis.call('LRANGE', KEYS[1], 0, -1)
if #items > 0 then
  redis.call('DEL', KEYS[1])
end
return items
`;

/**
 * Parse a batch of serialized notes from Redis, skipping any malformed
 * entries rather than crashing the whole reveal. A single bad blob (from
 * a partial write, schema-drift push, or manual tampering) would otherwise
 * surface as a JSON.parse throw inside the broadcast path and wedge the
 * sealed workflow for the whole room.
 */
function parseNoteEntries(raw: string[]): Note[] {
  const notes: Note[] = [];
  for (const entry of raw) {
    try {
      notes.push(JSON.parse(entry) as Note);
    } catch {
      // Malformed entry — drop it. The Lua reveal already cleared the list,
      // so losing it here is acceptable; logging is noisy because a torn
      // write during partition recovery can produce several at once.
    }
  }
  return notes;
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
  redis.defineCommand(PUSH_COMMAND, { numberOfKeys: 1, lua: PUSH_LUA });
  redis.defineCommand(REMOVE_COMMAND, { numberOfKeys: 1, lua: REMOVE_LUA });
  redis.defineCommand(UPDATE_COMMAND, { numberOfKeys: 1, lua: UPDATE_LUA });
  redis.defineCommand(DRAIN_COMMAND, { numberOfKeys: 1, lua: DRAIN_LUA });
  registered.add(redis);
}

type WithRevealCommand = Redis & {
  [COMMAND_NAME](key: string, threshold: string): Promise<string[]>;
  [PUSH_COMMAND](key: string, noteJson: string, ttlSeconds: string): Promise<number>;
  [REMOVE_COMMAND](key: string, noteId: string): Promise<number>;
  [UPDATE_COMMAND](key: string, noteId: string, noteJson: string): Promise<number>;
  [DRAIN_COMMAND](key: string): Promise<string[]>;
};

export function createSealedNotesStore(
  redis: Redis,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): SealedNotesStore {
  ensureRegistered(redis);
  const client = redis as WithRevealCommand;

  return {
    async push(roomId, note) {
      return client[PUSH_COMMAND](key(roomId), JSON.stringify(note), String(ttlSeconds));
    },

    async revealIfReady(roomId, threshold) {
      const raw = await client[COMMAND_NAME](key(roomId), String(threshold));
      return parseNoteEntries(raw);
    },

    async drain(roomId) {
      // LRANGE + DEL atomically in one Lua. Concurrent push on another pod
      // would land in a new key (we just deleted) — acceptable since the
      // caller is the owner-only jar:refresh path, rate-limited to 1 per 3s.
      const raw = await client[DRAIN_COMMAND](key(roomId));
      return parseNoteEntries(raw);
    },

    async remove(roomId, noteId) {
      await client[REMOVE_COMMAND](key(roomId), noteId);
    },

    async updateInBuffer(roomId, note) {
      // LSET by index preserves queue position — important so the reveal
      // still fires on the same threshold we were heading for.
      await client[UPDATE_COMMAND](key(roomId), note.id, JSON.stringify(note));
    },

    async length(roomId) {
      return redis.llen(key(roomId));
    },

    async clear(roomId) {
      await redis.del(key(roomId));
    },
  };
}
