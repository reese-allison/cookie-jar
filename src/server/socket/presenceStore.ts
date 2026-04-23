import type { RoomMember } from "@shared/types";
import type { Redis } from "ioredis";

export type AddMemberResult =
  | { ok: true; members: RoomMember[]; removed: string[] }
  | { ok: false; reason: "full" };

export interface PresenceStore {
  /** Add or overwrite a member in the room. */
  addMember(roomId: string, member: RoomMember): Promise<void>;
  /**
   * Atomically check role-specific capacity and add the member if there's
   * room, all in a single Lua script so two concurrent joins can't both
   * squeeze past the cap. Returns the post-insert member list on success.
   */
  addMemberIfUnderCap(
    roomId: string,
    member: RoomMember,
    maxParticipants: number,
    maxViewers: number,
  ): Promise<AddMemberResult>;
  /** Remove a member. No-op if absent. */
  removeMember(roomId: string, memberId: string): Promise<void>;
  /**
   * HDEL + HLEN in one round-trip. Used on disconnect where the caller needs
   * the post-remove count to decide whether to schedule the grace close.
   * Returns the member count AFTER the remove.
   */
  removeAndCount(roomId: string, memberId: string): Promise<number>;
  /**
   * Remove every entry in the room whose socketId isn't in `liveIds`. Returns
   * the ids that were removed. Used to reap "ghost" presence rows left behind
   * by pod crashes, pre-userId schema migrations, or reconnect storms that
   * outran the kick-prior logic.
   */
  reconcile(roomId: string, liveIds: Set<string>): Promise<string[]>;
  /** Full list of members for the room (unordered). */
  getMembers(roomId: string): Promise<RoomMember[]>;
  /** Number of members currently in the room. */
  memberCount(roomId: string): Promise<number>;
  /** Clear all members for a room (used on final teardown). */
  clearRoom(roomId: string): Promise<void>;
  /** Look up a member by id — used by the idle/color assignment paths. */
  getMember(roomId: string, memberId: string): Promise<RoomMember | null>;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const COMMAND_NAME = "cookieJarAddIfUnderCap";
const ADD_COMMAND = "cookieJarPresenceAdd";
const REMOVE_AND_COUNT_COMMAND = "cookieJarPresenceRemoveCount";
const RECONCILE_COMMAND = "cookieJarPresenceReconcile";

function key(roomId: string): string {
  return `room:${roomId}:members`;
}

// HSET + EXPIRE in one Lua so hosted Redis (Upstash etc.) charges 1 command
// instead of 2. Also guarantees we can never end up with a TTL-less key from
// a crash between the two writes.
const ADD_LUA = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

// HDEL + HLEN in one Lua — fires on every socket disconnect, so worth
// the 1-command-instead-of-2 savings on the hot path.
const REMOVE_AND_COUNT_LUA = `
redis.call('HDEL', KEYS[1], ARGV[1])
return redis.call('HLEN', KEYS[1])
`;

// HKEYS + HDEL(...) in one Lua. ARGV holds the ids to KEEP; anything not in
// that set is dropped. Used in the reconcile-after-full sad path.
const RECONCILE_LUA = `
local ids = redis.call('HKEYS', KEYS[1])
local keep = {}
for i = 1, #ARGV do keep[ARGV[i]] = true end
local removed = {}
for _, id in ipairs(ids) do
  if not keep[id] then
    table.insert(removed, id)
  end
end
if #removed > 0 then
  redis.call('HDEL', KEYS[1], unpack(removed))
end
return removed
`;

/**
 * Atomic capacity-check + insert. Without this, two concurrent joins can both
 * pass a hasCapacity check before either addMember lands and blow past the
 * cap. The script counts participants vs viewers (the two role buckets share
 * the same hash) using cjson, compares the relevant cap, and inserts in the
 * same RedisScript execution — so the check is trivially consistent.
 *
 * When `userId` is non-empty, any existing entries for that same userId are
 * removed before counting *and* inserting. That makes the script idempotent
 * across reconnect storms: if a flaky connection cycles and the old socket's
 * kick hasn't landed yet, we still end up with exactly one presence entry
 * per (room, userId).
 *
 * ARGV: [role, maxParticipants, maxViewers, memberId, memberJson, ttlSeconds, userId]
 * Returns a 3-element nested array: [flag, removedIds, memberJsons]
 *   - flag       : "1" on insert, "0" if the role's cap is already met (other
 *                  elements are empty in that case)
 *   - removedIds : ids of stale same-user entries we swept. Caller emits
 *                  room:member_left for each.
 *   - memberJsons: the post-insert roster as serialized JSON strings. The
 *                  Lua already walked HVALS to count, so returning the
 *                  roster here avoids a separate HGETALL round-trip.
 */
const ADD_IF_UNDER_CAP_LUA = `
local members = redis.call('HVALS', KEYS[1])
local role = ARGV[1]
local maxP = tonumber(ARGV[2])
local maxV = tonumber(ARGV[3])
local newMemberId = ARGV[4]
local newMemberJson = ARGV[5]
local ourUserId = ARGV[7]
local pcount = 0
local vcount = 0
local toRemove = {}
local keep = {}
for _, raw in ipairs(members) do
  local ok, obj = pcall(cjson.decode, raw)
  if ok and type(obj) == 'table' then
    if ourUserId ~= '' and obj.userId == ourUserId and obj.id ~= newMemberId then
      -- Stale entry for the same user — drop it instead of counting.
      table.insert(toRemove, obj.id)
    elseif obj.id == newMemberId then
      -- Same memberId (reconnect): skip the old blob so the new one replaces it.
    else
      if obj.role == 'viewer' then
        vcount = vcount + 1
      else
        pcount = pcount + 1
      end
      table.insert(keep, raw)
    end
  end
end
if role == 'viewer' then
  if vcount >= maxV then return {'0', {}, {}} end
else
  if pcount >= maxP then return {'0', {}, {}} end
end
for _, oid in ipairs(toRemove) do
  redis.call('HDEL', KEYS[1], oid)
end
redis.call('HSET', KEYS[1], newMemberId, newMemberJson)
redis.call('EXPIRE', KEYS[1], ARGV[6])
table.insert(keep, newMemberJson)
return {'1', toRemove, keep}
`;

const registered = new WeakSet<Redis>();

function ensureRegistered(redis: Redis): void {
  if (registered.has(redis)) return;
  redis.defineCommand(COMMAND_NAME, { numberOfKeys: 1, lua: ADD_IF_UNDER_CAP_LUA });
  redis.defineCommand(ADD_COMMAND, { numberOfKeys: 1, lua: ADD_LUA });
  redis.defineCommand(REMOVE_AND_COUNT_COMMAND, { numberOfKeys: 1, lua: REMOVE_AND_COUNT_LUA });
  redis.defineCommand(RECONCILE_COMMAND, { numberOfKeys: 1, lua: RECONCILE_LUA });
  registered.add(redis);
}

type AddCommandResult = [flag: string, removed: string[], members: string[]];
type WithAddCommand = Redis & {
  [COMMAND_NAME](
    key: string,
    role: string,
    maxParticipants: string,
    maxViewers: string,
    memberId: string,
    memberJson: string,
    ttlSeconds: string,
    userId: string,
  ): Promise<AddCommandResult>;
  [ADD_COMMAND](
    key: string,
    memberId: string,
    memberJson: string,
    ttlSeconds: string,
  ): Promise<number>;
  [REMOVE_AND_COUNT_COMMAND](key: string, memberId: string): Promise<number>;
  [RECONCILE_COMMAND](key: string, ...keepIds: string[]): Promise<string[]>;
};

/**
 * Redis-hash-backed presence. Source of truth is shared across pods, so
 * `room:state` renders identically regardless of which pod handles the join.
 *
 * We intentionally don't add per-member TTL sweeping here — that would need
 * heartbeats, and for a single-pod prod deploy it's overkill. When a pod
 * crashes its orphaned members stay until the next explicit remove or room
 * clear; a future heartbeat layer can tighten this if we see it cause trouble.
 */
export function createPresenceStore(
  redis: Redis,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): PresenceStore {
  ensureRegistered(redis);
  const client = redis as WithAddCommand;

  return {
    async addMember(roomId, member) {
      await client[ADD_COMMAND](key(roomId), member.id, JSON.stringify(member), String(ttlSeconds));
    },

    async addMemberIfUnderCap(roomId, member, maxParticipants, maxViewers) {
      const [flag, removed, memberJsons] = await client[COMMAND_NAME](
        key(roomId),
        member.role,
        String(maxParticipants),
        String(maxViewers),
        member.id,
        JSON.stringify(member),
        String(ttlSeconds),
        member.userId ?? "",
      );
      if (flag !== "1") return { ok: false, reason: "full" };
      const members = memberJsons.map((s) => JSON.parse(s) as RoomMember);
      return { ok: true, members, removed };
    },

    async removeMember(roomId, memberId) {
      await redis.hdel(key(roomId), memberId);
    },

    async removeAndCount(roomId, memberId) {
      return client[REMOVE_AND_COUNT_COMMAND](key(roomId), memberId);
    },

    async reconcile(roomId, liveIds) {
      return client[RECONCILE_COMMAND](key(roomId), ...liveIds);
    },

    async getMembers(roomId) {
      const raw = await redis.hgetall(key(roomId));
      return Object.values(raw).map((s) => JSON.parse(s) as RoomMember);
    },

    async memberCount(roomId) {
      return await redis.hlen(key(roomId));
    },

    async clearRoom(roomId) {
      await redis.del(key(roomId));
    },

    async getMember(roomId, memberId) {
      const raw = await redis.hget(key(roomId), memberId);
      return raw ? (JSON.parse(raw) as RoomMember) : null;
    },
  };
}
