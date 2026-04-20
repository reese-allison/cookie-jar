import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCacheBus } from "../../../src/server/socket/cacheBus";

let pub: Redis;
let sub: Redis;

beforeAll(() => {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  pub = new Redis(url);
  sub = pub.duplicate();
});

afterAll(async () => {
  await pub.quit();
  await sub.quit();
});

describe("cacheBus (Redis pub/sub)", () => {
  it("delivers invalidations to every subscribed handler", async () => {
    const bus = createCacheBus(pub, sub);
    const received: Array<{ scope: string; id: string }> = [];
    const done = new Promise<void>((resolve) => {
      bus.onInvalidate((msg) => {
        received.push(msg);
        resolve();
      });
    });
    // Give Redis a beat to register the subscription before publishing.
    await new Promise((r) => setTimeout(r, 50));

    await bus.publish({ scope: "room", id: "abc" });
    await done;

    expect(received).toEqual([{ scope: "room", id: "abc" }]);
    await bus.close();
  });

  it("fans out to multiple subscribers", async () => {
    const bus = createCacheBus(pub, sub);
    const a: Array<{ scope: string; id: string }> = [];
    const b: Array<{ scope: string; id: string }> = [];
    const waitFor = (arr: typeof a) =>
      new Promise<void>((resolve) => {
        bus.onInvalidate((msg) => {
          arr.push(msg);
          resolve();
        });
      });
    const gotA = waitFor(a);
    const gotB = waitFor(b);
    await new Promise((r) => setTimeout(r, 50));

    await bus.publish({ scope: "jar", id: "xyz" });
    await Promise.all([gotA, gotB]);

    expect(a[0]).toEqual({ scope: "jar", id: "xyz" });
    expect(b[0]).toEqual({ scope: "jar", id: "xyz" });
    await bus.close();
  });

  it("ignores malformed messages instead of throwing", async () => {
    const bus = createCacheBus(pub, sub);
    let calls = 0;
    bus.onInvalidate(() => {
      calls += 1;
    });
    await new Promise((r) => setTimeout(r, 50));

    // Raw publish of invalid JSON on the same channel.
    await pub.publish("cookie-jar:cache-invalidate", "not-json{");
    await new Promise((r) => setTimeout(r, 50));

    expect(calls).toBe(0);
    await bus.close();
  });
});
