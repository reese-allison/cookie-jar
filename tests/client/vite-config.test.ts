import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guard against accidental regressions on prod build hygiene.
describe("vite prod build config", () => {
  const cfg = readFileSync(resolve(__dirname, "../../vite.config.ts"), "utf-8");

  it("disables source maps for production builds", () => {
    expect(cfg).toMatch(/sourcemap:\s*false/);
  });

  it("reports compressed bundle size", () => {
    expect(cfg).toMatch(/reportCompressedSize:\s*true/);
  });

  it("pins an explicit build target", () => {
    expect(cfg).toMatch(/target:\s*["']es\d{4}["']/);
  });

  it("splits heavy vendors into named chunks", () => {
    // Heavy deps should land in their own chunks so they cache independently
    // and download in parallel. If someone deletes manualChunks this guard
    // will catch the regression.
    expect(cfg).toContain("vendor-realtime");
    expect(cfg).toContain("vendor-motion");
    expect(cfg).toContain("vendor-auth");
  });
});
