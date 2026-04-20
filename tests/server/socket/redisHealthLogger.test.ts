import { EventEmitter } from "node:events";
import type Redis from "ioredis";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { attachRedisHealthLogger } from "../../../src/server/socket/redisHealthLogger";

class FakeRedis extends EventEmitter {}

function silentLogger() {
  const entries: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  const logger = pino(
    { level: "debug" },
    {
      write(chunk: string) {
        for (const line of chunk.split("\n")) {
          if (!line) continue;
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const { level, msg, time, env, ...rest } = parsed;
          entries.push({
            level: String(level),
            obj: rest as Record<string, unknown>,
            msg: String(msg),
          });
          void time;
          void env;
        }
      },
    },
  );
  return { logger, entries };
}

describe("attachRedisHealthLogger", () => {
  it("logs 'connected' on initial ready", () => {
    const { logger, entries } = silentLogger();
    const redis = new FakeRedis();
    attachRedisHealthLogger(redis as unknown as Redis, logger, "pub");
    redis.emit("ready");
    expect(entries.some((e) => e.msg === "redis connected" && e.obj.channel === "pub")).toBe(true);
  });

  it("logs 'closed — degraded' + 'reconnected' with recovery time", () => {
    const { logger, entries } = silentLogger();
    const redis = new FakeRedis();
    attachRedisHealthLogger(redis as unknown as Redis, logger, "state");
    redis.emit("close");
    redis.emit("reconnecting", 500);
    redis.emit("ready");
    const msgs = entries.map((e) => e.msg);
    expect(msgs).toContain("redis connection closed — degraded");
    expect(msgs).toContain("redis reconnecting");
    expect(msgs).toContain("redis reconnected");
    const reconnected = entries.find((e) => e.msg === "redis reconnected");
    expect(reconnected?.obj.recoveredAfterMs).toBeTypeOf("number");
  });

  it("does not re-log 'degraded' while already in degraded state", () => {
    const { logger, entries } = silentLogger();
    const redis = new FakeRedis();
    attachRedisHealthLogger(redis as unknown as Redis, logger, "sub");
    redis.emit("close");
    redis.emit("close");
    redis.emit("close");
    const degradedCount = entries.filter(
      (e) => e.msg === "redis connection closed — degraded",
    ).length;
    expect(degradedCount).toBe(1);
  });

  it("logs a final error when the client gives up reconnecting", () => {
    const { logger, entries } = silentLogger();
    const redis = new FakeRedis();
    attachRedisHealthLogger(redis as unknown as Redis, logger, "kick");
    redis.emit("end");
    const msg = entries.find((e) => e.msg === "redis connection ended — no further reconnects");
    expect(msg).toBeTruthy();
    expect(msg?.level).toBe("50"); // pino error = 50
  });

  // Silence unused-var lint for vi import, used elsewhere in typical tests.
  void vi;
});
