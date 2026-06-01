/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const social = vi.fn();
const anonymous = vi.fn();
let isDev = true;

vi.mock("../../../src/client/lib/auth-client", () => ({
  get IS_DEV() {
    return isDev;
  },
  signIn: { social: (...args: unknown[]) => social(...args), anonymous: () => anonymous() },
}));

import { AuthButtons } from "../../../src/client/components/AuthButtons";

beforeEach(() => {
  social.mockReset();
  anonymous.mockReset();
  isDev = true;
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

/** Full-path callback the buttons should hand to better-auth. */
function currentCallback() {
  return window.location.origin + window.location.pathname + window.location.search;
}

describe("AuthButtons", () => {
  it("renders Google and Discord sign-in buttons", () => {
    render(<AuthButtons />);
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /sign in with discord/i })).toBeDefined();
  });

  it("calls signIn.social with the google provider and a client-origin callback URL", () => {
    render(<AuthButtons />);
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: currentCallback(),
    });
  });

  it("calls signIn.social with the discord provider and a client-origin callback URL", () => {
    // The callbackURL must point at the client origin, not the API origin —
    // otherwise OAuth lands on a "Cannot GET /" page after redirect.
    render(<AuthButtons />);
    fireEvent.click(screen.getByRole("button", { name: /sign in with discord/i }));
    expect(social).toHaveBeenCalledWith({
      provider: "discord",
      callbackURL: currentCallback(),
    });
  });

  it("preserves the room path in the callback URL so OAuth returns to the room being viewed", () => {
    // A viewer who hits "Sign in to participate" from inside /ABCDEFG must land
    // back on /ABCDEFG after OAuth — not the bare origin. The callback is read
    // at click time (not module load) so client-side navigation is reflected.
    window.history.pushState({}, "", "/ABCDEFG");
    render(<AuthButtons />);
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    const { callbackURL } = social.mock.calls[0][0] as { callbackURL: string };
    expect(callbackURL).toBe(`${window.location.origin}/ABCDEFG`);
    expect(callbackURL.endsWith("/ABCDEFG")).toBe(true);
  });

  it("renders the anonymous dev button when IS_DEV is true", () => {
    render(<AuthButtons />);
    const btn = screen.getByRole("button", { name: /continue anonymously/i });
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(anonymous).toHaveBeenCalled();
  });

  it("hides the anonymous dev button outside of dev builds", () => {
    isDev = false;
    render(<AuthButtons />);
    expect(screen.queryByRole("button", { name: /continue anonymously/i })).toBeNull();
  });
});
