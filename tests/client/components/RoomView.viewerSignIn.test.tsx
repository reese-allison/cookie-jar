/**
 * @vitest-environment jsdom
 *
 * Viewer notice must be an actionable sign-in affordance, not dead text.
 * Before this change the room presented `<p>Sign in to participate</p>` and
 * left users hunting for a login entry point.
 */
import type { Room } from "@shared/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomView } from "../../../src/client/components/RoomView";

afterEach(cleanup);

const room: Room = {
  id: "r1",
  code: "ABC123",
  jarId: "j1",
  state: "unlocked",
  maxParticipants: 50,
  maxViewers: 200,
  idleTimeoutMinutes: 30,
  createdAt: new Date().toISOString(),
  members: [
    {
      id: "u1",
      displayName: "Guest",
      role: "viewer",
      color: "#888",
      connectedAt: new Date().toISOString(),
    },
  ],
};

const baseProps = {
  room,
  cursors: new Map(),
  inJarCount: 0,
  pulledNotes: [],
  isAdding: false,
  isViewer: true,
  isOwner: false,
  showPulledBy: false,
  showAuthors: false,
  sealedCount: 0,
  sealedRevealAt: 0,
  onMouseMove: vi.fn(),
  onLock: vi.fn(),
  onUnlock: vi.fn(),
  onLeave: vi.fn(),
  onJarRefresh: vi.fn(),
  onAddNote: vi.fn(),
  onPull: vi.fn(),
  onDiscard: vi.fn(),
  onReturn: vi.fn(),
  onDragNote: vi.fn(),
  onDragNoteEnd: vi.fn(),
  history: [],
  onGetHistory: vi.fn(),
};

describe("RoomView viewer sign-in affordance", () => {
  it("renders the viewer notice as a button that calls onSignIn", () => {
    const onSignIn = vi.fn();
    render(<RoomView {...baseProps} onSignIn={onSignIn} />);
    const btn = screen.getByRole("button", { name: /sign in to participate/i });
    fireEvent.click(btn);
    expect(onSignIn).toHaveBeenCalled();
  });

  it("does not render the viewer notice when the user can contribute", () => {
    render(<RoomView {...baseProps} isViewer={false} onSignIn={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /sign in to participate/i })).toBeNull();
  });
});
