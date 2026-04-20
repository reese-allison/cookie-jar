import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleTimeoutManager } from "../../../src/server/socket/idleTimeout";

describe("IdleTimeoutManager — single-pod (no Redis)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onTimeout after the specified duration", () => {
    const onTimeout = vi.fn();
    const manager = new IdleTimeoutManager();
    manager.start("room-1", 1, onTimeout); // 1 minute
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).toHaveBeenCalledWith("room-1");
  });

  it("resets the timer on activity", () => {
    const onTimeout = vi.fn();
    const manager = new IdleTimeoutManager();
    manager.start("room-1", 1, onTimeout);
    vi.advanceTimersByTime(30_000);
    manager.resetActivity("room-1");
    vi.advanceTimersByTime(30_000);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(onTimeout).toHaveBeenCalledWith("room-1");
  });

  it("clears timeout when room is stopped", () => {
    const onTimeout = vi.fn();
    const manager = new IdleTimeoutManager();
    manager.start("room-1", 1, onTimeout);
    manager.stop("room-1");
    vi.advanceTimersByTime(120_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("handles multiple rooms independently", () => {
    const onTimeout = vi.fn();
    const manager = new IdleTimeoutManager();
    manager.start("room-1", 1, onTimeout);
    manager.start("room-2", 2, onTimeout);
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith("room-1");
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).toHaveBeenCalledTimes(2);
    expect(onTimeout).toHaveBeenCalledWith("room-2");
  });
});

describe("IdleTimeoutManager — multi-pod (Redis)", () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  });

  afterAll(async () => {
    await redis.quit();
  });

  afterEach(async () => {
    const keys = await redis.keys("room:idle-test-*");
    if (keys.length > 0) await redis.del(...keys);
  });

  it("reschedules locally when Redis says the room is still active elsewhere", async () => {
    const manager = new IdleTimeoutManager(redis);
    const cb = vi.fn();
    // Tiny duration (~60 ms) so the local timer fires quickly.
    manager.start("idle-test-1", 60 / 60_000, cb);
    // Simulate another pod refreshing the alive key before the local timer fires.
    await redis.set("room:idle-test-1:alive", "1", "PX", 5_000);
    await new Promise((r) => setTimeout(r, 150));
    expect(cb).not.toHaveBeenCalled();
    manager.stop("idle-test-1");
  });

  it("fires onTimeout when the room is actually idle cluster-wide", async () => {
    const manager = new IdleTimeoutManager(redis);
    const cb = vi.fn();
    // start() seeds the alive key with 2× duration TTL — we explicitly delete
    // it so the timer fires with the key absent and onTimeout runs.
    manager.start("idle-test-2", 40 / 60_000, cb);
    await redis.del("room:idle-test-2:alive");
    await new Promise((r) => setTimeout(r, 120));
    expect(cb).toHaveBeenCalledWith("idle-test-2");
  });

  it("only one of two competing managers wins the close race", async () => {
    const managerA = new IdleTimeoutManager(redis);
    const managerB = new IdleTimeoutManager(redis);
    const cbA = vi.fn();
    const cbB = vi.fn();
    managerA.start("idle-test-3", 30 / 60_000, cbA);
    managerB.start("idle-test-3", 30 / 60_000, cbB);
    await redis.del("room:idle-test-3:alive");
    await new Promise((r) => setTimeout(r, 150));
    const fired = [cbA, cbB].filter((c) => c.mock.calls.length > 0);
    expect(fired).toHaveLength(1);
  });
});
