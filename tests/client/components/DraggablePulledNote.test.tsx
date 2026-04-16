/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraggablePulledNote } from "../../../src/client/components/DraggablePulledNote";
import type { Note } from "../../../src/shared/types";

const TEST_NOTE: Note = {
  id: "note-1",
  jarId: "jar-1",
  text: "Draggable note",
  style: "sticky",
  state: "pulled",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

afterEach(cleanup);

describe("DraggablePulledNote", () => {
  it("renders the note text", () => {
    const jarRect = createRef<DOMRect | null>();
    const discardRect = createRef<DOMRect | null>();
    render(
      <DraggablePulledNote
        note={TEST_NOTE}
        onDiscard={vi.fn()}
        onReturn={vi.fn()}
        onHover={vi.fn()}
        jarRect={jarRect}
        discardRect={discardRect}
      />,
    );
    expect(screen.getByText("Draggable note")).toBeDefined();
  });

  it("button fallbacks still work for accessibility", () => {
    const onDiscard = vi.fn();
    const onReturn = vi.fn();
    const jarRect = createRef<DOMRect | null>();
    const discardRect = createRef<DOMRect | null>();
    render(
      <DraggablePulledNote
        note={TEST_NOTE}
        onDiscard={onDiscard}
        onReturn={onReturn}
        onHover={vi.fn()}
        jarRect={jarRect}
        discardRect={discardRect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalledWith("note-1");

    fireEvent.click(screen.getByRole("button", { name: /return/i }));
    expect(onReturn).toHaveBeenCalledWith("note-1");
  });
});
