import type { Redis } from "ioredis";

export interface DedupStore {
  /**
   * Atomically record that `newSocketId` now owns the (roomId, userId) slot.
   * Returns the previously-claimed socketId, if any. Caller decides whether
   * to disconnect the old socket locally or publish a cross-pod kick.
   */
  claim(roomId: string, userId: string, newSocketId: string): Promise<string | null>;
  /**
   * Release the slot only if the current value still matches `socketId` —
   * prevents a race where this socket's disconnect fires after a newer tab
   * has already claimed the slot.
   */
  release(roomId: string, userId: string, socketId: string): Promise<void>;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24h — longest reasonable session
const COMMAND_NAME = "cookieJarDedupRelease";

function key(roomId: string, userId: string): string {
  return `room:${roomId}:user:${userId}`;
}

// Compare-and-delete: only remove the key if its value still matches. Without
// this, the disconnect handler of an old socket could clobber a newer tab's
// claim that happened in between.
const COMPARE_AND_DELETE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

// Module-level flag so we only call defineCommand once per process — calling
// it a second time throws.
const registered = new WeakSet<Redis>();

function ensureRegistered(redis: Redis): void {
  if (registered.has(redis)) return;
  redis.defineCommand(COMMAND_NAME, { numberOfKeys: 1, lua: COMPARE_AND_DELETE_LUA });
  registered.add(redis);
}

type WithDedupCommand = Redis & {
  [COMMAND_NAME](key: string, socketId: string): Promise<number>;
};

export function createDedupStore(
  redis: Redis,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): DedupStore {
  ensureRegistered(redis);
  const client = redis as WithDedupCommand;

  return {
    async claim(roomId, userId, newSocketId) {
      // SET ... GET returns the old value, then sets the new. Atomic in Redis.
      // ioredis's typed `.set()` doesn't expose the GET modifier cleanly, so
      // we drop to the raw command.
      const prior = (await redis.call(
        "SET",
        key(roomId, userId),
        newSocketId,
        "EX",
        ttlSeconds,
        "GET",
      )) as string | null;
      return prior ?? null;
    },

    async release(roomId, userId, socketId) {
      await client[COMMAND_NAME](key(roomId, userId), socketId);
    },
  };
}
