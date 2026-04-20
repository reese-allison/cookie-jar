import type { RoomMember } from "@shared/types";
import type Redis from "ioredis";

export interface PresenceStore {
  /** Add or overwrite a member in the room. */
  addMember(roomId: string, member: RoomMember): Promise<void>;
  /** Remove a member. No-op if absent. */
  removeMember(roomId: string, memberId: string): Promise<void>;
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

function key(roomId: string): string {
  return `room:${roomId}:members`;
}

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
  return {
    async addMember(roomId, member) {
      const k = key(roomId);
      await redis.hset(k, member.id, JSON.stringify(member));
      await redis.expire(k, ttlSeconds);
    },

    async removeMember(roomId, memberId) {
      await redis.hdel(key(roomId), memberId);
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
