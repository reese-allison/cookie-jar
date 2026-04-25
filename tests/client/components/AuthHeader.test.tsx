/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoomStore } from "../../../src/client/stores/roomStore";

const signOut = vi.fn();
vi.mock("../../../src/client/lib/auth-client", () => ({
  signOut: () => signOut(),
}));

import { AuthHeader } from "../../../src/client/components/AuthHeader";

const fetchMock = vi.fn();

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ownedJars: [], starredJars: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  useRoomStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useRoomStore.getState().reset();
});

const USER = { displayName: "Alice" };

describe("AuthHeader", () => {
  it("renders just the signed-out TopBar when no user is present", () => {
    const onRequestSignIn = vi.fn();
    render(
      <AuthHeader
        user={null}
        onJoinRoom={vi.fn()}
        onCreateRoom={vi.fn()}
        onRequestSignIn={onRequestSignIn}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(onRequestSignIn).toHaveBeenCalled();
    // Drawer affordances must not appear when there's no user.
    expect(screen.queryByRole("button", { name: /my jars/i })).toBeNull();
  });

  it("opens the My Jars drawer from the TopBar", async () => {
    render(
      <AuthHeader
        user={USER}
        onJoinRoom={vi.fn()}
        onCreateRoom={vi.fn()}
        onRequestSignIn={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /my jars/i }));
    // The drawer's empty state proves it rendered with open=true.
    await waitFor(() => {
      expect(screen.getByText(/haven't made or starred any jars/i)).toBeDefined();
    });
  });

  it("invokes signOut on Sign out", async () => {
    render(
      <AuthHeader
        user={USER}
        onJoinRoom={vi.fn()}
        onCreateRoom={vi.fn()}
        onRequestSignIn={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it("calls onLeaveRoom before signing out when the user is currently in a room", async () => {
    // The cleanup ordering matters: leaving the room while the session still
    // exists keeps the server-side state consistent. Reverse order would let
    // the server tear the socket down and surface a transient error to the UI.
    useRoomStore.setState({
      room: {
        code: "ABCDEF",
        jarId: "j1",
        members: [],
        ownerId: "u1",
        notes: [],
        pulledNotes: [],
        config: {} as never,
        appearance: {} as never,
      } as never,
    });
    const onLeaveRoom = vi.fn();
    render(
      <AuthHeader
        user={USER}
        onJoinRoom={vi.fn()}
        onCreateRoom={vi.fn()}
        onRequestSignIn={vi.fn()}
        onLeaveRoom={onLeaveRoom}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(onLeaveRoom).toHaveBeenCalled();
    expect(onLeaveRoom.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0],
    );
  });

  it("does not call onLeaveRoom when no room is open", async () => {
    const onLeaveRoom = vi.fn();
    render(
      <AuthHeader
        user={USER}
        onJoinRoom={vi.fn()}
        onCreateRoom={vi.fn()}
        onRequestSignIn={vi.fn()}
        onLeaveRoom={onLeaveRoom}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(onLeaveRoom).not.toHaveBeenCalled();
  });
});
