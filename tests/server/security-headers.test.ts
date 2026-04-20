import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { applySecurityHeaders } from "../../src/server/middleware/securityHeaders";

function buildApp() {
  const app = express();
  applySecurityHeaders(app);
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  return app;
}

describe("security headers", () => {
  it("sets core hardening headers on API responses", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toMatch(/DENY|SAMEORIGIN/i);
    expect(res.headers["referrer-policy"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toContain("max-age=");
    expect(res.headers["x-dns-prefetch-control"]).toBeDefined();
  });

  it("removes x-powered-by", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("emits a restrictive CSP for the API surface", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/health");
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("does not enforce same-origin COOP (would break OAuth popup flows)", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/health");
    const coop = res.headers["cross-origin-opener-policy"];
    if (coop !== undefined) {
      expect(coop).not.toBe("same-origin");
    }
  });
});
