import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDedupStore } from "../../../src/server/socket/dedupStore";

let redis: Redis;

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
});

afterAll(async () => {
  await redis.quit();
});

afterEach(async () => {
  const keys = await redis.keys("room:dedup-test-*:user:*");
  if (keys.length > 0) await redis.del(...keys);
});

describe("dedupStore (Redis)", () => {
  it("first claim returns null (no prior socket)", async () => {
    const store = createDedupStore(redis);
    expect(await store.claim("dedup-test-1", "u1", "sock-a")).toBeNull();
  });

  it("second claim returns the prior socket id", async () => {
    const store = createDedupStore(redis);
    await store.claim("dedup-test-2", "u1", "sock-a");
    expect(await store.claim("dedup-test-2", "u1", "sock-b")).toBe("sock-a");
  });

  it("claim updates the stored value", async () => {
    const store = createDedupStore(redis);
    await store.claim("dedup-test-3", "u1", "sock-a");
    await store.claim("dedup-test-3", "u1", "sock-b");
    expect(await store.claim("dedup-test-3", "u1", "sock-c")).toBe("sock-b");
  });

  it("isolates rooms and users", async () => {
    const store = createDedupStore(redis);
    await store.claim("dedup-test-4a", "u1", "sock-a");
    await store.claim("dedup-test-4b", "u1", "sock-b");
    expect(await store.claim("dedup-test-4a", "u1", "sock-c")).toBe("sock-a");
    expect(await store.claim("dedup-test-4b", "u1", "sock-d")).toBe("sock-b");
  });

  it("release clears the slot when value matches", async () => {
    const store = createDedupStore(redis);
    await store.claim("dedup-test-5", "u1", "sock-a");
    await store.release("dedup-test-5", "u1", "sock-a");
    expect(await store.claim("dedup-test-5", "u1", "sock-b")).toBeNull();
  });

  it("release is a no-op when value has changed (stale disconnect race)", async () => {
    const store = createDedupStore(redis);
    await store.claim("dedup-test-6", "u1", "sock-a");
    // A new tab claimed the slot before the old one's disconnect fired.
    await store.claim("dedup-test-6", "u1", "sock-b");
    // Old socket's release — must NOT clobber the newer claim.
    await store.release("dedup-test-6", "u1", "sock-a");
    expect(await store.claim("dedup-test-6", "u1", "sock-c")).toBe("sock-b");
  });
});
