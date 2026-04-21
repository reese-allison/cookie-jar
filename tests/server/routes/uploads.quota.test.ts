import Redis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRedisQuota } from "../../../src/server/routes/uploads";

let redis: Redis;

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
});

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  const keys = await redis.keys("uploads:quota:*");
  if (keys.length > 0) await redis.del(...keys);
});

describe("createRedisQuota", () => {
  it("allows uploads under the cap", async () => {
    const q = createRedisQuota(redis, { bytesPerDay: 1000, windowSeconds: 60 });
    expect(await q.reserve("user-1", 400)).toBe(true);
    expect(await q.reserve("user-1", 500)).toBe(true);
  });

  it("rejects the upload that would cross the cap and does not consume it", async () => {
    const q = createRedisQuota(redis, { bytesPerDay: 1000, windowSeconds: 60 });
    expect(await q.reserve("user-2", 900)).toBe(true);
    // 900 + 200 > 1000 → rejected AND rolled back
    expect(await q.reserve("user-2", 200)).toBe(false);
    // A smaller follow-up that fits in the remaining 100 must still pass.
    expect(await q.reserve("user-2", 100)).toBe(true);
  });

  it("isolates users from each other", async () => {
    const q = createRedisQuota(redis, { bytesPerDay: 500, windowSeconds: 60 });
    expect(await q.reserve("user-a", 500)).toBe(true);
    expect(await q.reserve("user-a", 1)).toBe(false);
    expect(await q.reserve("user-b", 500)).toBe(true);
  });

  it("sets the TTL on first reserve so quotas expire", async () => {
    const q = createRedisQuota(redis, { bytesPerDay: 1000, windowSeconds: 42 });
    await q.reserve("user-ttl", 100);
    const ttl = await redis.ttl("uploads:quota:user-ttl");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(42);
  });

  it("does not reset the TTL on subsequent reserves", async () => {
    const q = createRedisQuota(redis, { bytesPerDay: 1000, windowSeconds: 300 });
    await q.reserve("user-ttl2", 100);
    const firstTtl = await redis.ttl("uploads:quota:user-ttl2");
    // Force a small wait so the TTL would differ if we mistakenly reset it.
    await new Promise((r) => setTimeout(r, 1100));
    await q.reserve("user-ttl2", 100);
    const secondTtl = await redis.ttl("uploads:quota:user-ttl2");
    expect(secondTtl).toBeLessThan(firstTtl);
  });
});
