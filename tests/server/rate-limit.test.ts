import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildRateLimiter } from "../../src/server/middleware/rateLimit";

function buildApp(limit: number) {
  const app = express();
  app.use(buildRateLimiter({ windowMs: 60_000, limit, prefix: "test" }));
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("rate limit middleware", () => {
  it("allows requests up to the limit", async () => {
    const app = buildApp(3);
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).get("/ping");
      expect(res.status).toBe(200);
    }
  });

  it("blocks the next request with 429 after the limit", async () => {
    const app = buildApp(3);
    for (let i = 0; i < 3; i += 1) {
      await request(app).get("/ping");
    }
    const blocked = await request(app).get("/ping");
    expect(blocked.status).toBe(429);
  });

  it("emits RateLimit-* standard headers", async () => {
    const app = buildApp(5);
    const res = await request(app).get("/ping");
    expect(res.headers["ratelimit-limit"]).toBe("5");
    expect(res.headers["ratelimit-remaining"]).toBe("4");
  });
});
