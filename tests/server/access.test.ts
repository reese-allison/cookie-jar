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

// Most cases don't exercise the email path, so default emailVerified=true
// unless a test pins it explicitly. OAuth-issued sessions are always verified
// so this reflects the common case.
const VERIFIED = { emailVerified: true };
const UNVERIFIED = { emailVerified: false };

describe("canAccessJar", () => {
  it("owner always passes", () => {
    const jar = makeJar();
    expect(canAccessJar(jar, { userId: "owner-1", email: null, ...VERIFIED })).toBe(true);
  });

  it("public jar is open to anyone", () => {
    const jar = makeJar({ isPublic: true });
    expect(canAccessJar(jar, { userId: null, email: null, ...VERIFIED })).toBe(true);
    expect(canAccessJar(jar, { userId: "stranger", email: null, ...VERIFIED })).toBe(true);
  });

  it("template jar is open to anyone", () => {
    const jar = makeJar({ isTemplate: true });
    expect(canAccessJar(jar, { userId: null, email: null, ...VERIFIED })).toBe(true);
  });

  it("private jar with no allowlist is owner-only", () => {
    const jar = makeJar();
    expect(canAccessJar(jar, { userId: "stranger", email: "x@y.com", ...VERIFIED })).toBe(false);
    expect(canAccessJar(jar, { userId: null, email: null, ...VERIFIED })).toBe(false);
  });

  it("allowlisted userId passes even on a private jar", () => {
    const jar = makeJar({ config: makeJarConfig({ allowedUserIds: ["friend-1"] }) });
    expect(canAccessJar(jar, { userId: "friend-1", email: null, ...VERIFIED })).toBe(true);
    expect(canAccessJar(jar, { userId: "stranger", email: null, ...VERIFIED })).toBe(false);
  });

  it("allowlisted email passes when verified (case-insensitive)", () => {
    const jar = makeJar({ config: makeJarConfig({ allowedEmails: ["friend@example.com"] }) });
    expect(
      canAccessJar(jar, { userId: "stranger", email: "FRIEND@example.com", ...VERIFIED }),
    ).toBe(true);
    expect(canAccessJar(jar, { userId: "stranger", email: "notme@example.com", ...VERIFIED })).toBe(
      false,
    );
  });

  it("allowlisted email is rejected when the viewer's email is unverified", () => {
    // Regression: a user who signed up with an unverified alice@example.com
    // must not step into a jar that allowlists alice@example.com. OAuth
    // flows arrive verified, so real-world OAuth users still pass.
    const jar = makeJar({ config: makeJarConfig({ allowedEmails: ["alice@example.com"] }) });
    expect(
      canAccessJar(jar, { userId: "someone-else", email: "alice@example.com", ...UNVERIFIED }),
    ).toBe(false);
    expect(
      canAccessJar(jar, { userId: "someone-else", email: "alice@example.com", ...VERIFIED }),
    ).toBe(true);
  });

  it("anonymous viewer cannot satisfy the allowlist", () => {
    const jar = makeJar({ config: makeJarConfig({ allowedEmails: ["a@b.com"] }) });
    expect(canAccessJar(jar, { userId: null, email: null, ...VERIFIED })).toBe(false);
  });

  it("userId allowlist match does NOT require emailVerified", () => {
    // emailVerified only gates email matches — a viewer allowlisted by user
    // id should pass regardless of their email verification state.
    const jar = makeJar({ config: makeJarConfig({ allowedUserIds: ["friend-1"] }) });
    expect(canAccessJar(jar, { userId: "friend-1", email: null, ...UNVERIFIED })).toBe(true);
  });
});

describe("canJoinJar", () => {
  it("private jar without an allowlist lets anyone with the code in (legacy)", () => {
    const jar = makeJar();
    expect(canJoinJar(jar, { userId: null, email: null, ...VERIFIED })).toBe(true);
    expect(canJoinJar(jar, { userId: "stranger", email: "x@y.com", ...VERIFIED })).toBe(true);
  });

  it("private jar with allowlist rejects strangers", () => {
    const jar = makeJar({ config: makeJarConfig({ allowedEmails: ["friend@example.com"] }) });
    expect(canJoinJar(jar, { userId: null, email: null, ...VERIFIED })).toBe(false);
    expect(canJoinJar(jar, { userId: "stranger", email: "other@example.com", ...VERIFIED })).toBe(
      false,
    );
  });

  it("private jar with allowlist accepts owner and allowlisted users", () => {
    const jar = makeJar({
      config: makeJarConfig({ allowedEmails: ["friend@example.com"] }),
    });
    expect(canJoinJar(jar, { userId: "owner-1", email: null, ...VERIFIED })).toBe(true);
    expect(canJoinJar(jar, { userId: null, email: "friend@example.com", ...VERIFIED })).toBe(true);
  });

  it("public jar is always joinable", () => {
    const jar = makeJar({ isPublic: true });
    expect(canJoinJar(jar, { userId: null, email: null, ...VERIFIED })).toBe(true);
  });
});
