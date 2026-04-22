/**
 * @vitest-environment jsdom
 *
 * Star button placement + gating in the room header.
 *
 * - Owners never see the star (server rejects self-stars with 400; the UI
 *   must match). The component is doubly-gated: App.tsx omits `onToggleStar`
 *   for owners AND RoomView checks `!isOwner`. Either gate alone should hide
 *   the star — guard both.
 * - For contributors the star must sit immediately before the sound toggle
 *   so all the tiny icons (settings/star/sound) cluster together.
 */
import type { Room } from "@shared/types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomView } from "../../../src/client/components/RoomView";

afterEach(cleanup);

const room: Room = {
  id: "r1",
  code: "ABC123",
  jarId: "j1",
  state: "open",
  maxParticipants: 50,
  maxViewers: 200,
  idleTimeoutMinutes: 30,
  createdAt: new Date().toISOString(),
  members: [
    {
      id: "u1",
      displayName: "Guest",
      role: "contributor",
      color: "#888",
      connectedAt: new Date().toISOString(),
    },
  ],
};

const baseProps = {
  room,
  inJarCount: 0,
  pulledNotes: [],
  isAdding: false,
  isViewer: false,
  isOwner: false,
  showPulledBy: false,
  showAuthors: false,
  sealedCount: 0,
  sealedRevealAt: 0,
  onMouseMove: vi.fn(),
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

describe("RoomView star placement + gating", () => {
  it("does not render the star button for jar owners", () => {
    render(<RoomView {...baseProps} isOwner={true} onToggleStar={vi.fn()} isStarred={false} />);
    expect(screen.queryByRole("button", { name: /star this jar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /unstar this jar/i })).toBeNull();
  });

  it("renders the star button for non-owners when onToggleStar is provided", () => {
    render(<RoomView {...baseProps} isOwner={false} onToggleStar={vi.fn()} isStarred={false} />);
    expect(screen.getByRole("button", { name: /star this jar/i })).toBeDefined();
  });

  it("places the star button immediately before the sound toggle", () => {
    render(<RoomView {...baseProps} isOwner={false} onToggleStar={vi.fn()} isStarred={false} />);
    const star = screen.getByRole("button", { name: /star this jar/i });
    const sound = screen.getByRole("button", { name: /mute sounds|unmute sounds/i });
    // DOCUMENT_POSITION_FOLLOWING = 4: sound comes after star
    expect(star.compareDocumentPosition(sound) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And there's nothing else between them (star's next element sibling is sound).
    expect(star.nextElementSibling).toBe(sound);
  });
});
