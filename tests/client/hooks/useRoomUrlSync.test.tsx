/**
 * @vitest-environment jsdom
 *
 * The room-URL sync exists so a refresh on /ABCDEF keeps the user in the room
 * (and so mobile browsers that sleep a tab don't kick the user back to the
 * landing page — the tab has a real URL now). It's also the back/forward
 * button's bridge to join/leave semantics.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoomUrlSync } from "../../../src/client/hooks/useRoomUrlSync";
import { useRoomStore } from "../../../src/client/stores/roomStore";

function resetUrl(path: string) {
  window.history.replaceState({}, "", path);
}

function resetStore() {
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
}

function Harness(props: {
  joinRoom: (code: string, displayName: string) => void;
  leaveRoom: () => void;
  displayName: string;
  canAutoJoin: boolean;
  onInitialCode?: (code: string | null) => void;
}) {
  const initialCode = useRoomUrlSync({
    joinRoom: props.joinRoom,
    leaveRoom: props.leaveRoom,
    displayName: props.displayName,
    canAutoJoin: props.canAutoJoin,
  });
  props.onInitialCode?.(initialCode);
  return null;
}

beforeEach(() => {
  resetStore();
  resetUrl("/");
});

afterEach(() => {
  cleanup();
  resetStore();
  resetUrl("/");
});

describe("useRoomUrlSync", () => {
  it("returns null initialCode when the URL has no code", () => {
    resetUrl("/");
    let captured: string | null | undefined;
    render(
      <Harness
        joinRoom={vi.fn()}
        leaveRoom={vi.fn()}
        displayName="Alex"
        canAutoJoin={true}
        onInitialCode={(c) => {
          captured = c;
        }}
      />,
    );
    expect(captured).toBeNull();
  });

  it("extracts a valid code from /ABCDEF and auto-joins when allowed", () => {
    resetUrl("/ABCDEF");
    const joinRoom = vi.fn();
    let captured: string | null | undefined;
    render(
      <Harness
        joinRoom={joinRoom}
        leaveRoom={vi.fn()}
        displayName="Alex"
        canAutoJoin={true}
        onInitialCode={(c) => {
          captured = c;
        }}
      />,
    );
    expect(captured).toBe("ABCDEF");
    expect(joinRoom).toHaveBeenCalledWith("ABCDEF", "Alex");
  });

  it("does not auto-join when canAutoJoin is false (unauthenticated landing)", () => {
    resetUrl("/ABCDEF");
    const joinRoom = vi.fn();
    render(<Harness joinRoom={joinRoom} leaveRoom={vi.fn()} displayName="" canAutoJoin={false} />);
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it("ignores garbage paths that do not parse as a room code", () => {
    resetUrl("/not-a-code");
    const joinRoom = vi.fn();
    let captured: string | null | undefined;
    render(
      <Harness
        joinRoom={joinRoom}
        leaveRoom={vi.fn()}
        displayName="Alex"
        canAutoJoin={true}
        onInitialCode={(c) => {
          captured = c;
        }}
      />,
    );
    expect(captured).toBeNull();
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it("does not clobber the URL on mount when the store has not yet joined", () => {
    // Regression: on reload of /ABCDEF, the initial render has room=null, so
    // a naive `currentCode → URL` effect pushed `/` and wiped the code before
    // the auto-join effect could read it. The mount effect must be a no-op.
    resetUrl("/ABCDEF");
    render(
      <Harness joinRoom={vi.fn()} leaveRoom={vi.fn()} displayName="Alex" canAutoJoin={false} />,
    );
    expect(window.location.pathname).toBe("/ABCDEF");
  });

  it("pushes the room code into the URL when room state arrives", () => {
    resetUrl("/");
    render(
      <Harness joinRoom={vi.fn()} leaveRoom={vi.fn()} displayName="Alex" canAutoJoin={true} />,
    );
    act(() => {
      useRoomStore.setState({
        room: {
          id: "r1",
          code: "ZYXWVU",
          jarId: "j1",
          members: [],
          isLocked: false,
        },
      });
    });
    expect(window.location.pathname).toBe("/ZYXWVU");
  });

  it("resets the URL to / when the room is cleared (leave)", () => {
    resetUrl("/ZYXWVU");
    useRoomStore.setState({
      room: {
        id: "r1",
        code: "ZYXWVU",
        jarId: "j1",
        members: [],
        isLocked: false,
      },
    });
    render(
      <Harness joinRoom={vi.fn()} leaveRoom={vi.fn()} displayName="Alex" canAutoJoin={true} />,
    );
    act(() => {
      useRoomStore.setState({ room: null });
    });
    expect(window.location.pathname).toBe("/");
  });

  it("calls leaveRoom when the user navigates back to /", () => {
    resetUrl("/ZYXWVU");
    useRoomStore.setState({
      room: {
        id: "r1",
        code: "ZYXWVU",
        jarId: "j1",
        members: [],
        isLocked: false,
      },
    });
    const leaveRoom = vi.fn();
    render(
      <Harness joinRoom={vi.fn()} leaveRoom={leaveRoom} displayName="Alex" canAutoJoin={true} />,
    );
    act(() => {
      window.history.replaceState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(leaveRoom).toHaveBeenCalled();
  });

  it("calls joinRoom when the user navigates forward to /CODE", () => {
    resetUrl("/");
    const joinRoom = vi.fn();
    render(
      <Harness joinRoom={joinRoom} leaveRoom={vi.fn()} displayName="Alex" canAutoJoin={true} />,
    );
    act(() => {
      window.history.replaceState({}, "", "/ABCDEF");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(joinRoom).toHaveBeenCalledWith("ABCDEF", "Alex");
  });
});
