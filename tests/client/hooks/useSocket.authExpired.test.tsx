/**
 * @vitest-environment jsdom
 *
 * Regression guard: `auth:expired` only sets an error toast, which
 * auto-dismisses in 6s. A busy user will miss it. The App-level
 * onAuthExpired opener should pop the sign-in modal automatically.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket {
  connected = false;
  disconnected = false;
  id = "fake-sid";
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  on(event: string, cb: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
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
  fire(event: string, ...args: unknown[]) {
    const list = this.handlers.get(event) ?? [];
    for (const h of list) h(...args);
  }
}

const fakeSocket = new FakeSocket();

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => fakeSocket),
}));

vi.mock("../../../src/client/lib/auth-client", () => ({
  useSession: () => ({ data: null }),
  signIn: { social: vi.fn(), anonymous: vi.fn() },
  signOut: vi.fn(),
  IS_DEV: true,
}));

vi.mock("../../../src/client/lib/sounds", () => ({
  soundManager: {
    play: vi.fn(),
    setCustomPack: vi.fn(),
    clearCustomPack: vi.fn(),
    isEnabled: () => true,
    setEnabled: vi.fn(),
  },
}));

import App from "../../../src/client/App";
import { useNoteStore } from "../../../src/client/stores/noteStore";
import { useRoomStore } from "../../../src/client/stores/roomStore";

beforeEach(() => {
  useNoteStore.getState().reset();
  useRoomStore.getState().reset();
});

afterEach(cleanup);

describe("useSocket auth:expired handler", () => {
  it("opens the sign-in modal so the user can re-auth immediately", () => {
    render(<App />);

    // Sign-in modal is closed initially (dialog element is only rendered when open).
    expect(screen.queryByRole("dialog", { name: /sign in/i })).toBeNull();

    act(() => {
      fakeSocket.fire("auth:expired");
    });

    // After auth:expired the modal should be open.
    expect(screen.queryByRole("dialog", { name: /sign in/i })).not.toBeNull();
  });
});
