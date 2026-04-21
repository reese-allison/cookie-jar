import { describe, expect, it } from "vitest";
import { canAccessJar, canJoinJar } from "../../src/server/access";
import type { Jar } from "../../src/shared/types";
import { makeJarAppearance, makeJarConfig } from "../helpers/fixtures";

function makeJar(overrides: Partial<Jar> = {}): Jar {
  return {
    id: "jar-1",
    ownerId: "owner-1",
    name: "Jar",
    appearance: makeJarAppearance(),
    config: makeJarConfig(),
    isTemplate: false,
    isPublic: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("canAccessJar", () => {
  it("owner always passes", () => {
    const jar = makeJar();
    expect(canAccessJar(jar, { userId: "owner-1", email: null })).toBe(true);
  });

  it("public jar is open to anyone", () => {
    const jar = makeJar({ isPublic: true });
    expect(canAccessJar(jar, { userId: null, email: null })).toBe(true);
    expect(canAccessJar(jar, { userId: "stranger", email: null })).toBe(true);
  });

  it("template jar is open to anyone", () => {
    const jar = makeJar({ isTemplate: true });
    expect(canAccessJar(jar, { userId: null, email: null })).toBe(true);
  });

  it("private jar with no allowlist is owner-only", () => {
    const jar = makeJar();
    expect(canAccessJar(jar, { userId: "stranger", email: "x@y.com" })).toBe(false);
    expect(canAccessJar(jar, { userId: null, email: null })).toBe(false);
  });

  it("allowlisted userId passes even on a private jar", () => {
    const jar = makeJar({ config: makeJarConfig({ allowedUserIds: ["friend-1"] }) });
    expect(canAccessJar(jar, { userId: "friend-1", email: null })).toBe(true);
    expect(canAccessJar(jar, { userId: "stranger", email: null })).toBe(false);
  });

  it("allowlisted email passes (case-insensitive)", () => {
    const jar = makeJar({ config: makeJarConfig({ allowedEmails: ["friend@example.com"] }) });
    expect(canAccessJar(jar, { userId: "stranger", email: "FRIEND@example.com" })).toBe(true);
    expect(canAccessJar(jar, { userId: "stranger", email: "notme@example.com" })).toBe(false);
  });

  it("anonymous viewer cannot satisfy the allowlist", () => {
    const jar = makeJar({ config: makeJarConfig({ allowedEmails: ["a@b.com"] }) });
    expect(canAccessJar(jar, { userId: null, email: null })).toBe(false);
  });
});

describe("canJoinJar", () => {
  it("private jar without an allowlist lets anyone with the code in (legacy)", () => {
    const jar = makeJar();
    expect(canJoinJar(jar, { userId: null, email: null })).toBe(true);
    expect(canJoinJar(jar, { userId: "stranger", email: "x@y.com" })).toBe(true);
  });

  it("private jar with allowlist rejects strangers", () => {
    const jar = makeJar({ config: makeJarConfig({ allowedEmails: ["friend@example.com"] }) });
    expect(canJoinJar(jar, { userId: null, email: null })).toBe(false);
    expect(canJoinJar(jar, { userId: "stranger", email: "other@example.com" })).toBe(false);
  });

  it("private jar with allowlist accepts owner and allowlisted users", () => {
    const jar = makeJar({
      config: makeJarConfig({ allowedEmails: ["friend@example.com"] }),
    });
    expect(canJoinJar(jar, { userId: "owner-1", email: null })).toBe(true);
    expect(canJoinJar(jar, { userId: null, email: "friend@example.com" })).toBe(true);
  });

  it("public jar is always joinable", () => {
    const jar = makeJar({ isPublic: true });
    expect(canJoinJar(jar, { userId: null, email: null })).toBe(true);
  });
});
