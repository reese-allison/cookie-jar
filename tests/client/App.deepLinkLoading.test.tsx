/**
 * @vitest-environment jsdom
 *
 * CLS guard: when the URL deep-links to a room (e.g. /ABCDEF) and the user
 * is signed in, App must NOT paint the LandingScreen ("Cookie Jar" hero,
 * join/host form) for the few hundred ms it takes for `room:state` to
 * arrive. That paint-then-swap was the source of a layout shift Lighthouse
 * flagged. Instead, we render a neutral loading shell sized to the viewport
 * so the layout is stable from first paint through to the in-room view.
 *
 * Anonymous visitors still see LandingScreen with the code prefilled — they
 * need to pick a guest name first, no auto-join, no shell.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket {
  connected = false;
  disconnected = false;
  id = "fake-sid";
  on() {
    return this;
  }
  off() {
    return this;
  }
  emit() {
    return this;
  }
  connect() {
    this.connected = true;
    return this;
  }
  disconnect() {
    this.connected = false;
    this.disconnected = true;
    return this;
  }
}

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => new FakeSocket()),
}));

const useSessionMock = vi.fn();
vi.mock("../../src/client/lib/auth-client", () => ({
  useSession: () => useSessionMock(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../../src/client/lib/sounds", () => ({
  soundManager: {
    play: vi.fn(),
    setCustomPack: vi.fn(),
    clearCustomPack: vi.fn(),
    isEnabled: () => true,
    setEnabled: vi.fn(),
  },
}));

import App from "../../src/client/App";
import { useRoomStore } from "../../src/client/stores/roomStore";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  useRoomStore.setState(
    {
      room: null,
      isConnected: false,
      isJoining: false,
      error: null,
      myId: null,
      cursors: new Map(),
    },
    false,
  );
  useSessionMock.mockReturnValue({ data: { user: { name: "Tester", image: null } } });
});
afterEach(cleanup);

describe("App deep-link loading shell", () => {
  it("renders a loading shell — not LandingScreen — when authed and the URL has a room code", () => {
    window.history.replaceState({}, "", "/ABCDEF");
    render(<App />);

    // LandingScreen's hero must not paint.
    expect(screen.queryByRole("heading", { name: /cookie jar/i })).toBeNull();
    // The shell announces itself for assistive tech.
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });

  it("swaps the shell for InRoomScreen as soon as room:state arrives", async () => {
    window.history.replaceState({}, "", "/ABCDEF");
    render(<App />);
    expect(screen.queryByRole("heading", { name: /cookie jar/i })).toBeNull();

    act(() => {
      useRoomStore.setState({
        room: { id: "r1", code: "ABCDEF", jarId: "j1", members: [], isLocked: false },
      });
    });

    // InRoomScreen is lazy — the shell stays as the Suspense fallback for one
    // microtask while the chunk resolves, then it disappears.
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("still shows LandingScreen for anonymous users on a deep link (they must pick a name)", () => {
    useSessionMock.mockReturnValue({ data: null });
    window.history.replaceState({}, "", "/ABCDEF");
    render(<App />);
    expect(screen.queryByRole("heading", { name: /cookie jar/i })).not.toBeNull();
  });

  it("shows LandingScreen on the bare landing path (no code) for authed users", () => {
    window.history.replaceState({}, "", "/");
    render(<App />);
    expect(screen.queryByRole("heading", { name: /cookie jar/i })).not.toBeNull();
  });
});
