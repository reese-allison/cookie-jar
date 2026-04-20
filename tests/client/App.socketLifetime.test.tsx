/**
 * @vitest-environment jsdom
 *
 * Regression guard for the "Connection lost. Reconnecting..." banner that
 * appeared forever after creating/joining a room. Calling `useSocket` in two
 * sibling trees (LandingScreen / InRoomScreen) tore the socket down the
 * moment `room:state` arrived. The socket must survive the Landing → InRoom
 * transition.
 */
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Count `io()` invocations across the lifetime of App. Each call creates a
// new socket — any number > 1 means the socket was recreated on a re-render.
const ioCalls: Array<{ socket: FakeSocket; connected: boolean }> = [];

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
}

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const socket = new FakeSocket();
    ioCalls.push({ socket, connected: false });
    return socket;
  }),
}));

vi.mock("../../src/client/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { name: "Tester", image: null } } }),
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
  ioCalls.length = 0;
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
});
afterEach(cleanup);

describe("App socket lifetime", () => {
  it("keeps a single socket alive across the Landing → InRoom transition", () => {
    render(<App />);
    expect(ioCalls.length).toBe(1);
    const socket = ioCalls[0].socket;
    // Pretend the server just accepted our room:join — this triggers App to
    // swap from LandingScreen to InRoomScreen, which used to remount useSocket.
    act(() => {
      useRoomStore.setState({
        room: {
          id: "room-1",
          code: "ABCDEF",
          jarId: "jar-1",
          members: [],
          isLocked: false,
        },
      });
    });
    expect(ioCalls.length).toBe(1);
    expect(socket.disconnected).toBe(false);
  });
});
