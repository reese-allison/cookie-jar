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
  /** Whether a specific member is in the room. */
  hasMember(roomId: string, memberId: string): Promise<boolean>;
  /** Clear all members for a room (used on final teardown). */
  clearRoom(roomId: string): Promise<void>;
  /** Look up a member by id — used by the idle/color assignment paths. */
  getMember(roomId: string, memberId: string): Promise<RoomMember | null>;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const COMMAND_NAME = "cookieJarAddIfUnderCap";

function key(roomId: string): string {
  return `room:${roomId}:members`;
}

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
 * Returns: { insertedFlag, swept_id1, swept_id2, ... } where insertedFlag is
 * "1" on insert or "0" if the role's cap is already met. The swept ids let
 * the caller emit room:member_left for stale entries we dropped.
 */
const ADD_IF_UNDER_CAP_LUA = `
local members = redis.call('HVALS', KEYS[1])
local role = ARGV[1]
local maxP = tonumber(ARGV[2])
local maxV = tonumber(ARGV[3])
local newMemberId = ARGV[4]
local ourUserId = ARGV[7]
local pcount = 0
local vcount = 0
local toRemove = {}
for _, raw in ipairs(members) do
  local ok, obj = pcall(cjson.decode, raw)
  if ok and type(obj) == 'table' then
    if ourUserId ~= '' and obj.userId == ourUserId and obj.id ~= newMemberId then
      -- Stale entry for the same user — drop it instead of counting.
      table.insert(toRemove, obj.id)
    else
      if obj.role == 'viewer' then
        vcount = vcount + 1
      else
        pcount = pcount + 1
      end
    end
  end
end
if role == 'viewer' then
  if vcount >= maxV then return {'0'} end
else
  if pcount >= maxP then return {'0'} end
end
for _, oid in ipairs(toRemove) do
  redis.call('HDEL', KEYS[1], oid)
end
redis.call('HSET', KEYS[1], ARGV[4], ARGV[5])
redis.call('EXPIRE', KEYS[1], ARGV[6])
local result = {'1'}
for _, oid in ipairs(toRemove) do
  table.insert(result, oid)
end
return result
`;

const registered = new WeakSet<Redis>();

function ensureRegistered(redis: Redis): void {
  if (registered.has(redis)) return;
  redis.defineCommand(COMMAND_NAME, { numberOfKeys: 1, lua: ADD_IF_UNDER_CAP_LUA });
  registered.add(redis);
}

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
  ): Promise<string[]>;
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
      const k = key(roomId);
      await redis.hset(k, member.id, JSON.stringify(member));
      await redis.expire(k, ttlSeconds);
    },

    async addMemberIfUnderCap(roomId, member, maxParticipants, maxViewers) {
      const result = await client[COMMAND_NAME](
        key(roomId),
        member.role,
        String(maxParticipants),
        String(maxViewers),
        member.id,
        JSON.stringify(member),
        String(ttlSeconds),
        member.userId ?? "",
      );
      const [flag, ...removed] = result;
      if (flag !== "1") return { ok: false, reason: "full" };
      // Fetch the updated roster so the caller can emit room:state without
      // a second round-trip.
      const raw = await redis.hgetall(key(roomId));
      const members = Object.values(raw).map((s) => JSON.parse(s) as RoomMember);
      return { ok: true, members, removed };
    },

    async removeMember(roomId, memberId) {
      await redis.hdel(key(roomId), memberId);
    },

    async reconcile(roomId, liveIds) {
      const k = key(roomId);
      const raw = await redis.hgetall(k);
      const toRemove: string[] = [];
      for (const [id] of Object.entries(raw)) {
        if (!liveIds.has(id)) toRemove.push(id);
      }
      if (toRemove.length > 0) await redis.hdel(k, ...toRemove);
      return toRemove;
    },

    async getMembers(roomId) {
      const raw = await redis.hgetall(key(roomId));
      return Object.values(raw).map((s) => JSON.parse(s) as RoomMember);
    },

    async memberCount(roomId) {
      return await redis.hlen(key(roomId));
    },

    async hasMember(roomId, memberId) {
      return (await redis.hexists(key(roomId), memberId)) === 1;
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
