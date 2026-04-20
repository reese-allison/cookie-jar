import express from "express";
import type Redis from "ioredis";
import type pg from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHealthRouter, type HealthDeps } from "../../src/server/routes/health";

function mountApp(overrides: Partial<HealthDeps> = {}) {
  const deps: HealthDeps = {
    pool: { query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }) } as unknown as pg.Pool,
    redis: { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis,
    socketsCount: () => 3,
    ...overrides,
  };
  const app = express();
  app.use("/api", createHealthRouter(deps));
  return { app, deps };
}

describe("health routes", () => {
  describe("GET /api/live", () => {
    it("returns 200 regardless of upstream state", async () => {
      const { app } = mountApp({
        pool: {
          query: vi.fn().mockRejectedValue(new Error("db down")),
        } as unknown as pg.Pool,
      });
      const res = await request(app).get("/api/live");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  describe("GET /api/ready", () => {
    it("returns 200 when DB and Redis are healthy", async () => {
      const { app } = mountApp();
      const res = await request(app).get("/api/ready");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: "ready",
        db: true,
        cache: true,
        sockets: 3,
      });
    });

    it("returns 503 when the DB check fails", async () => {
      const { app } = mountApp({
        pool: {
          query: vi.fn().mockRejectedValue(new Error("boom")),
        } as unknown as pg.Pool,
      });
      const res = await request(app).get("/api/ready");
      expect(res.status).toBe(503);
      expect(res.body.db).toBe(false);
      expect(res.body.cache).toBe(true);
    });

    it("returns 503 when Redis PING fails", async () => {
      const { app } = mountApp({
        redis: {
          ping: vi.fn().mockRejectedValue(new Error("nope")),
        } as unknown as Redis,
      });
      const res = await request(app).get("/api/ready");
      expect(res.status).toBe(503);
      expect(res.body.cache).toBe(false);
      expect(res.body.db).toBe(true);
    });

    it("includes current socket count in the payload", async () => {
      const { app } = mountApp({ socketsCount: () => 42 });
      const res = await request(app).get("/api/ready");
      expect(res.body.sockets).toBe(42);
    });
  });
});
