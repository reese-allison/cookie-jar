/**
 * @vitest-environment jsdom
 *
 * Touch devices get a button-only flow — no drag handlers, no discard bin.
 * Touch drag kept triggering multi-touch gestures and felt inconsistent, so
 * we fall back to the explicit Return / Discard buttons already on each note.
 */
import type { Room } from "@shared/types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomView } from "../../../src/client/components/RoomView";

afterEach(() => {
  cleanup();
  // biome-ignore lint/suspicious/noExplicitAny: restoring jsdom default
  delete (window as any).matchMedia;
});

function setMatchMedia(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("pointer: coarse") ? coarse : false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    media: query,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

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
      displayName: "Me",
      role: "contributor",
      color: "#888",
      connectedAt: new Date().toISOString(),
    },
  ],
};

const pulledNote = {
  id: "n1",
  jarId: "j1",
  text: "hi",
  style: "sticky" as const,
  state: "pulled" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const baseProps = {
  room,
  inJarCount: 0,
  pulledNotes: [pulledNote],
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

describe("RoomView on touch devices", () => {
  beforeEach(() => setMatchMedia(true));

  it("does not render the discard bin", () => {
    render(<RoomView {...baseProps} />);
    expect(screen.queryByRole("img", { name: /discard/i })).toBeNull();
  });

  it("renders pulled notes without drag styling (no grab cursor, no touch-action:none)", () => {
    const { container } = render(<RoomView {...baseProps} />);
    const note = container.querySelector(".draggable-pulled-note") as HTMLElement | null;
    expect(note).not.toBeNull();
    if (note) {
      expect(note.style.cursor).not.toBe("grab");
      expect(note.style.touchAction).not.toBe("none");
    }
  });
});

describe("RoomView on pointer devices", () => {
  beforeEach(() => setMatchMedia(false));

  it("renders the discard bin", () => {
    render(<RoomView {...baseProps} />);
    expect(screen.getByRole("img", { name: /discard/i })).toBeDefined();
  });

  it("renders pulled notes with drag styling", () => {
    const { container } = render(<RoomView {...baseProps} />);
    const note = container.querySelector(".draggable-pulled-note") as HTMLElement | null;
    expect(note).not.toBeNull();
    if (note) {
      expect(note.style.cursor).toBe("grab");
      expect(note.style.touchAction).toBe("none");
    }
  });
});
