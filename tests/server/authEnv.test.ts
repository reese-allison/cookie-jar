import { describe, expect, it, vi } from "vitest";
import { resolveAuthSecret, shouldEnableAnonPlugin } from "../../src/server/auth";

describe("shouldEnableAnonPlugin", () => {
  it("enables anon in development", () => {
    expect(shouldEnableAnonPlugin("development")).toBe(true);
  });

  it("enables anon in test", () => {
    expect(shouldEnableAnonPlugin("test")).toBe(true);
  });

  it("disables anon in production", () => {
    expect(shouldEnableAnonPlugin("production")).toBe(false);
  });

  it("disables anon when NODE_ENV is unset", () => {
    expect(shouldEnableAnonPlugin(undefined)).toBe(false);
  });

  it("disables anon for ambiguous names (staging, preview, 'prod')", () => {
    expect(shouldEnableAnonPlugin("staging")).toBe(false);
    expect(shouldEnableAnonPlugin("preview")).toBe(false);
    expect(shouldEnableAnonPlugin("prod")).toBe(false);
  });
});

describe("resolveAuthSecret", () => {
  it("returns the provided secret verbatim when set", () => {
    expect(resolveAuthSecret("production", "real-secret")).toBe("real-secret");
    expect(resolveAuthSecret(undefined, "real-secret")).toBe("real-secret");
  });

  it("falls back to the dev string in development (with warning)", () => {
    const warn = vi.fn();
    const out = resolveAuthSecret("development", undefined, warn);
    expect(out).toBe("dev-only-secret-not-for-production");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("falls back silently in test", () => {
    const warn = vi.fn();
    const out = resolveAuthSecret("test", undefined, warn);
    expect(out).toBe("dev-only-secret-not-for-production");
    expect(warn).not.toHaveBeenCalled();
  });

  it("throws when NODE_ENV is unset and secret is missing", () => {
    expect(() => resolveAuthSecret(undefined, undefined)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("throws in production without a secret", () => {
    expect(() => resolveAuthSecret("production", undefined)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("throws for ambiguous environments (staging, preview)", () => {
    expect(() => resolveAuthSecret("staging", undefined)).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => resolveAuthSecret("preview", undefined)).toThrow(/BETTER_AUTH_SECRET/);
  });
});
