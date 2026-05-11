import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { wwwRedirect } from "../../src/server/middleware/wwwRedirect";

function buildApp() {
  const app = express();
  app.use(wwwRedirect);
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/echo", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("wwwRedirect", () => {
  it("308-redirects www.* to the apex over https, preserving the path and query", async () => {
    const res = await request(buildApp())
      .get("/health?foo=bar")
      .set("Host", "www.the-cookie-jar.app");
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://the-cookie-jar.app/health?foo=bar");
  });

  it("passes through requests on the apex host", async () => {
    const res = await request(buildApp()).get("/health").set("Host", "the-cookie-jar.app");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("passes through localhost during development", async () => {
    const res = await request(buildApp()).get("/health").set("Host", "localhost:3001");
    expect(res.status).toBe(200);
  });

  it("preserves the HTTP method on non-GET requests (308, not 301)", async () => {
    // 301 would silently downgrade a POST to a GET. better-auth's OAuth
    // callbacks happen to be GET so 301 is fine for the happy path, but
    // anything else (say a future webhook on the www host) would break.
    const res = await request(buildApp()).post("/echo").set("Host", "www.the-cookie-jar.app");
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://the-cookie-jar.app/echo");
  });

  it("strips only the leading www. label on deeper subdomains", async () => {
    const res = await request(buildApp()).get("/x").set("Host", "www.api.the-cookie-jar.app");
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://api.the-cookie-jar.app/x");
  });
});
