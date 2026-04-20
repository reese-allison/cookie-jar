import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKickBus } from "../../../src/server/socket/kickBus";

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

describe("kickBus (Redis pub/sub)", () => {
  it("delivers published messages to subscribed handlers", async () => {
    const bus = createKickBus(pub, sub);
    const received: Array<{ socketId: string; reason?: string }> = [];
    const done = new Promise<void>((resolve) => {
      bus.onKick((msg) => {
        received.push(msg);
        resolve();
      });
    });
    // Give Redis a beat to register the subscription before publishing.
    await new Promise((r) => setTimeout(r, 50));
    await bus.publishKick({ socketId: "sock-a", reason: "other tab" });
    await done;
    expect(received).toEqual([{ socketId: "sock-a", reason: "other tab" }]);
    await bus.close();
  });

  it("delivers to multiple handlers", async () => {
    // Fresh bus with its own sub client — previous test closed the channel.
    const sub2 = pub.duplicate();
    const bus = createKickBus(pub, sub2);
    const a: string[] = [];
    const b: string[] = [];
    bus.onKick((m) => a.push(m.socketId));
    bus.onKick((m) => b.push(m.socketId));
    await new Promise((r) => setTimeout(r, 50));
    await bus.publishKick({ socketId: "sock-z" });
    await new Promise((r) => setTimeout(r, 50));
    expect(a).toEqual(["sock-z"]);
    expect(b).toEqual(["sock-z"]);
    await bus.close();
    await sub2.quit();
  });
});
