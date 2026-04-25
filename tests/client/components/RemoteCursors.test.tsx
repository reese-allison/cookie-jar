/**
 * @vitest-environment jsdom
 */
import type { CursorPosition, RoomMember } from "@shared/types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RemoteCursors } from "../../../src/client/components/RemoteCursors";
import { useRoomStore } from "../../../src/client/stores/roomStore";

afterEach(cleanup);
beforeEach(() => useRoomStore.getState().reset());

function member(id: string, displayName: string, color = "#FF6B6B"): RoomMember {
  return {
    id,
    displayName,
    role: "contributor",
    color,
    connectedAt: "2026-04-25T00:00:00Z",
  };
}

function setCursors(entries: CursorPosition[]) {
  for (const c of entries) useRoomStore.getState().setCursor(c);
}

describe("RemoteCursors", () => {
  it("renders one Cursor per member with a known cursor position", () => {
    setCursors([
      { userId: "alice", x: 100, y: 200 },
      { userId: "bob", x: 300, y: 400 },
    ]);
    render(<RemoteCursors members={[member("alice", "Alice"), member("bob", "Bob")]} />);
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
  });

  it("ignores cursor packets from members no longer in the room", () => {
    // A peer who left but whose last cursor packet is still in the store
    // shouldn't ghost-render — we only draw cursors for current members.
    setCursors([
      { userId: "alice", x: 10, y: 10 },
      { userId: "ghost", x: 20, y: 20 },
    ]);
    render(<RemoteCursors members={[member("alice", "Alice")]} />);
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.queryByText("Ghost")).toBeNull();
  });

  it("returns nothing when hidden (touch devices have no pointer)", () => {
    setCursors([{ userId: "alice", x: 10, y: 10 }]);
    const { container } = render(<RemoteCursors members={[member("alice", "Alice")]} hidden />);
    expect(container.firstChild).toBeNull();
  });

  it("is wrapped in React.memo so the cursor layer doesn't churn the room", () => {
    expect((RemoteCursors as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });
});
