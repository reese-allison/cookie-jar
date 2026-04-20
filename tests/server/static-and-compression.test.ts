import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildCompression,
  buildSoundsStatic,
  buildUploadsStatic,
} from "../../src/server/middleware/static";

describe("compression middleware", () => {
  it("gzips JSON responses that exceed the threshold", async () => {
    const app = express();
    app.use(buildCompression());
    app.get("/data", (_req, res) => {
      res.json({
        items: Array.from({ length: 500 }, (_, i) => ({ i, val: "hello world" })),
      });
    });
    const res = await request(app).get("/data").set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("does not compress tiny responses", async () => {
    const app = express();
    app.use(buildCompression());
    app.get("/ok", (_req, res) => res.json({ ok: true }));
    const res = await request(app).get("/ok").set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBeUndefined();
  });
});

describe("static routes", () => {
  let uploadsDir: string;
  let soundsDir: string;

  beforeAll(() => {
    uploadsDir = mkdtempSync(join(tmpdir(), "cj-uploads-"));
    soundsDir = mkdtempSync(join(tmpdir(), "cj-sounds-"));
    writeFileSync(join(uploadsDir, "jar.png"), "png-bytes");
    writeFileSync(join(soundsDir, "bell.mp3"), "mp3-bytes");
  });

  afterAll(() => {
    rmSync(uploadsDir, { recursive: true, force: true });
    rmSync(soundsDir, { recursive: true, force: true });
  });

  it("serves uploads with immutable one-year cache", async () => {
    const app = express();
    app.use("/uploads", buildUploadsStatic(uploadsDir));
    const res = await request(app).get("/uploads/jar.png");
    expect(res.status).toBe(200);
    const cc = res.headers["cache-control"] ?? "";
    expect(cc).toContain("public");
    expect(cc).toMatch(/max-age=31536000/);
    expect(cc).toContain("immutable");
  });

  it("serves sounds with shorter cache (not immutable)", async () => {
    const app = express();
    app.use("/sounds", buildSoundsStatic(soundsDir));
    const res = await request(app).get("/sounds/bell.mp3");
    expect(res.status).toBe(200);
    const cc = res.headers["cache-control"] ?? "";
    expect(cc).toContain("max-age=");
    expect(cc).not.toContain("immutable");
  });
});
