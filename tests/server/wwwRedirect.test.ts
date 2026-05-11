import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildWwwRedirect } from "../../src/server/middleware/wwwRedirect";

function buildApp(apex: string, opts: { trustProxy?: boolean } = {}) {
  const app = express();
  if (opts.trustProxy) app.set("trust proxy", 1);
  app.use(buildWwwRedirect(apex));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/echo", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("buildWwwRedirect", () => {
  it("308-redirects www.<apex> to the apex over https, preserving path and query", async () => {
    const res = await request(buildApp("the-cookie-jar.app"))
      .get("/health?foo=bar")
      .set("Host", "www.the-cookie-jar.app");
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://the-cookie-jar.app/health?foo=bar");
  });

  it("passes through requests on the apex host", async () => {
    const res = await request(buildApp("the-cookie-jar.app"))
      .get("/health")
      .set("Host", "the-cookie-jar.app");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("passes through localhost during development", async () => {
    const res = await request(buildApp("the-cookie-jar.app"))
      .get("/health")
      .set("Host", "localhost:3001");
    expect(res.status).toBe(200);
  });

  it("preserves HTTP method on non-GET (308 not 301)", async () => {
    // 301 silently downgrades POST to GET. 308 preserves the method.
    const res = await request(buildApp("the-cookie-jar.app"))
      .post("/echo")
      .set("Host", "www.the-cookie-jar.app");
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://the-cookie-jar.app/echo");
  });

  it("does NOT redirect to an attacker-controlled host (no open redirect)", async () => {
    // Regression guard: an earlier version slice'd `www.` off whatever host
    // the client claimed and reflected it into the Location header. A
    // request with `Host: www.evil.com` would redirect to `https://evil.com`.
    // The pinned-apex factory makes this a no-op — the middleware calls
    // next() and Express's default routing takes over (200 on /health, 404
    // elsewhere). Either way, what matters is no 308 and no Location.
    const res = await request(buildApp("the-cookie-jar.app"))
      .get("/health")
      .set("Host", "www.evil.com");
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
  });

  it("does NOT redirect deeper www-prefixed hosts that aren't the apex (www.api.<apex>)", async () => {
    // The factory only matches the exact `www.<apex>` host. A request to
    // `www.api.the-cookie-jar.app` is some other subdomain and should be
    // handled by whatever serves it.
    const res = await request(buildApp("the-cookie-jar.app"))
      .get("/health")
      .set("Host", "www.api.the-cookie-jar.app");
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
  });

  it("honors X-Forwarded-Host when `trust proxy` is set (Fly edge case)", async () => {
    // Fly's edge sets X-Forwarded-Host to the client-facing hostname. Without
    // `app.set('trust proxy', ...)`, Express ignores it and `req.hostname`
    // reads the raw Host header (which is whatever Fly's internal router
    // sends). With trust-proxy on, the redirect fires on the original host.
    const res = await request(buildApp("the-cookie-jar.app", { trustProxy: true }))
      .get("/health")
      .set("Host", "the-cookie-jar.fly.dev")
      .set("X-Forwarded-Host", "www.the-cookie-jar.app");
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://the-cookie-jar.app/health");
  });

  it("strips the port from Host header (req.hostname behavior)", async () => {
    // `req.hostname` already drops the :port suffix — pin the contract.
    const res = await request(buildApp("the-cookie-jar.app"))
      .get("/health")
      .set("Host", "www.the-cookie-jar.app:8080");
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://the-cookie-jar.app/health");
  });
});
