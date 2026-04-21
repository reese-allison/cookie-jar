/**
 * @vitest-environment jsdom
 *
 * Regression guard: before this fix, a socket disconnect (network blip, server
 * restart) left `isAdding` / `isPulling` stuck true — the user stared at a
 * spinner until the next rate_limited/room:error. The fix resets both flags
 * in the disconnect handler.
 */
import { cleanup, render } from "@testing-library/react";
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
  /** Test helper — fire whatever event the code has subscribed to. */
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
  signIn: vi.fn(),
  signOut: vi.fn(),
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

beforeEach(() => {
  useNoteStore.getState().reset();
});

afterEach(cleanup);

describe("useSocket disconnect handler", () => {
  it("resets isAdding and isPulling so the UI doesn't stay stuck on a spinner", () => {
    render(<App />);
    // Simulate the user having clicked Add + Pull just before a network blip.
    act(() => {
      useNoteStore.getState().setAdding(true);
      useNoteStore.getState().setPulling(true);
    });
    expect(useNoteStore.getState().isAdding).toBe(true);
    expect(useNoteStore.getState().isPulling).toBe(true);

    act(() => {
      fakeSocket.fire("disconnect");
    });

    expect(useNoteStore.getState().isAdding).toBe(false);
    expect(useNoteStore.getState().isPulling).toBe(false);
  });
});
