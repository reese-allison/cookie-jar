import { describe, expect, it } from "vitest";
import { createSocketRateLimiter } from "../../../src/server/socket/rateLimit";

describe("createSocketRateLimiter", () => {
  it("allows up to `burst` requests in quick succession", () => {
    const now = 0;
    const limiter = createSocketRateLimiter(() => now);
    // note:add bucket: ratePerSec=2, burst=5
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.allow("s1", "note:add")).toBe(true);
    }
    expect(limiter.allow("s1", "note:add")).toBe(false);
  });

  it("refills tokens at the configured rate", () => {
    let now = 0;
    const limiter = createSocketRateLimiter(() => now);
    // Drain
    for (let i = 0; i < 5; i += 1) limiter.allow("s1", "note:add");
    expect(limiter.allow("s1", "note:add")).toBe(false);
    // Advance 500 ms → +1 token at 2/s
    now += 500;
    expect(limiter.allow("s1", "note:add")).toBe(true);
    expect(limiter.allow("s1", "note:add")).toBe(false);
  });

  it("isolates buckets per socket id", () => {
    const now = 0;
    const limiter = createSocketRateLimiter(() => now);
    for (let i = 0; i < 5; i += 1) limiter.allow("s1", "note:add");
    expect(limiter.allow("s1", "note:add")).toBe(false);
    expect(limiter.allow("s2", "note:add")).toBe(true);
  });

  it("isolates buckets per event name", () => {
    const now = 0;
    const limiter = createSocketRateLimiter(() => now);
    for (let i = 0; i < 5; i += 1) limiter.allow("s1", "note:add");
    expect(limiter.allow("s1", "note:add")).toBe(false);
    // note:pull is a separate bucket
    expect(limiter.allow("s1", "note:pull")).toBe(true);
  });

  it("returns true for events without a configured limit", () => {
    const limiter = createSocketRateLimiter(() => 0);
    for (let i = 0; i < 1000; i += 1) {
      expect(limiter.allow("s1", "some:unthrottled-event")).toBe(true);
    }
  });

  it("enforces the slow history:get cadence (1 per 5s)", () => {
    let now = 0;
    const limiter = createSocketRateLimiter(() => now);
    expect(limiter.allow("s1", "history:get")).toBe(true);
    expect(limiter.allow("s1", "history:get")).toBe(false);
    now += 4999;
    expect(limiter.allow("s1", "history:get")).toBe(false);
    now += 2;
    expect(limiter.allow("s1", "history:get")).toBe(true);
  });

  it("dispose() clears all buckets for a socket", () => {
    const now = 0;
    const limiter = createSocketRateLimiter(() => now);
    for (let i = 0; i < 5; i += 1) limiter.allow("s1", "note:add");
    expect(limiter.allow("s1", "note:add")).toBe(false);
    limiter.dispose("s1");
    // Fresh bucket after dispose
    expect(limiter.allow("s1", "note:add")).toBe(true);
  });
});
