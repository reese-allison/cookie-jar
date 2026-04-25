/**
 * @vitest-environment jsdom
 *
 * `auth-client` is a thin wrapper around better-auth: it constructs the
 * client with `window.location.origin` and registers the anonymous plugin
 * only in dev. We don't re-test better-auth — we just verify the surface
 * we re-export and the dev-gating contract.
 */
import { describe, expect, it } from "vitest";
import { IS_DEV, signIn, signOut, useSession } from "../../../src/client/lib/auth-client";

describe("auth-client surface", () => {
  it("re-exports the better-auth methods the app uses", () => {
    expect(typeof signIn).toBe("function");
    expect(typeof signIn.social).toBe("function");
    expect(typeof signOut).toBe("function");
    expect(typeof useSession).toBe("function");
  });

  it("exposes IS_DEV mirroring import.meta.env.DEV", () => {
    expect(IS_DEV).toBe(import.meta.env.DEV);
  });

  it("exposes signIn.anonymous in dev for the dev-mode landing button", () => {
    // The anonymous plugin is registered only when import.meta.env.DEV is
    // true. In Vitest that's the case, so the function should exist.
    if (import.meta.env.DEV) {
      expect(typeof signIn.anonymous).toBe("function");
    }
  });
});
