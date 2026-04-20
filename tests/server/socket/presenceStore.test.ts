import type { RoomMember } from "@shared/types";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPresenceStore } from "../../../src/server/socket/presenceStore";

let redis: Redis;

function makeMember(id: string, name = id): RoomMember {
  return {
    id,
    displayName: name,
    role: "contributor",
    color: "#FF6B6B",
    connectedAt: new Date().toISOString(),
  };
}

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
});

afterAll(async () => {
  await redis.quit();
});

afterEach(async () => {
  const keys = await redis.keys("room:presence-test-*:members");
  if (keys.length > 0) await redis.del(...keys);
});

describe("presenceStore (Redis)", () => {
  it("addMember + getMembers round-trips", async () => {
    const store = createPresenceStore(redis);
    await store.addMember("presence-test-1", makeMember("m1", "Alice"));
    await store.addMember("presence-test-1", makeMember("m2", "Bob"));
    const members = await store.getMembers("presence-test-1");
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.displayName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("memberCount + hasMember", async () => {
    const store = createPresenceStore(redis);
    expect(await store.memberCount("presence-test-2")).toBe(0);
    await store.addMember("presence-test-2", makeMember("m1"));
    expect(await store.memberCount("presence-test-2")).toBe(1);
    expect(await store.hasMember("presence-test-2", "m1")).toBe(true);
    expect(await store.hasMember("presence-test-2", "m2")).toBe(false);
  });

  it("removeMember is a no-op on missing ids", async () => {
    const store = createPresenceStore(redis);
    await store.addMember("presence-test-3", makeMember("m1"));
    await store.removeMember("presence-test-3", "ghost");
    expect(await store.memberCount("presence-test-3")).toBe(1);
  });

  it("removeMember deletes the member", async () => {
    const store = createPresenceStore(redis);
    await store.addMember("presence-test-4", makeMember("m1"));
    await store.addMember("presence-test-4", makeMember("m2"));
    await store.removeMember("presence-test-4", "m1");
    const members = await store.getMembers("presence-test-4");
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe("m2");
  });

  it("getMember returns null for missing ids", async () => {
    const store = createPresenceStore(redis);
    await store.addMember("presence-test-5", makeMember("m1"));
    expect(await store.getMember("presence-test-5", "m1")).not.toBeNull();
    expect(await store.getMember("presence-test-5", "ghost")).toBeNull();
  });

  it("clearRoom drops the whole hash", async () => {
    const store = createPresenceStore(redis);
    await store.addMember("presence-test-6", makeMember("m1"));
    await store.addMember("presence-test-6", makeMember("m2"));
    await store.clearRoom("presence-test-6");
    expect(await store.memberCount("presence-test-6")).toBe(0);
  });

  it("isolates rooms", async () => {
    const store = createPresenceStore(redis);
    await store.addMember("presence-test-7a", makeMember("m1"));
    await store.addMember("presence-test-7b", makeMember("m2"));
    expect(await store.memberCount("presence-test-7a")).toBe(1);
    expect(await store.memberCount("presence-test-7b")).toBe(1);
    expect((await store.getMembers("presence-test-7a"))[0].id).toBe("m1");
  });

  describe("addMemberIfUnderCap", () => {
    it("accepts when under the participant cap", async () => {
      const store = createPresenceStore(redis);
      const r = await store.addMemberIfUnderCap("presence-test-8", makeMember("m1"), 3, 10);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.members).toHaveLength(1);
    });

    it("rejects the third participant when cap is 2", async () => {
      const store = createPresenceStore(redis);
      const a = await store.addMemberIfUnderCap("presence-test-9", makeMember("m1"), 2, 10);
      const b = await store.addMemberIfUnderCap("presence-test-9", makeMember("m2"), 2, 10);
      const c = await store.addMemberIfUnderCap("presence-test-9", makeMember("m3"), 2, 10);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(c.ok).toBe(false);
      expect(await store.memberCount("presence-test-9")).toBe(2);
    });

    it("counts viewers and participants separately", async () => {
      const store = createPresenceStore(redis);
      const viewer = (id: string): RoomMember => ({
        ...makeMember(id),
        role: "viewer",
      });
      await store.addMemberIfUnderCap("presence-test-10", viewer("v1"), 1, 1);
      // viewer cap hit — second viewer rejected
      const v2 = await store.addMemberIfUnderCap("presence-test-10", viewer("v2"), 1, 1);
      expect(v2.ok).toBe(false);
      // participant slot still open
      const p1 = await store.addMemberIfUnderCap("presence-test-10", makeMember("p1"), 1, 1);
      expect(p1.ok).toBe(true);
    });
  });
});
