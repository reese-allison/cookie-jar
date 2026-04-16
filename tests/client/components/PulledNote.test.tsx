/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PulledNote } from "../../../src/client/components/PulledNote";
import type { Note } from "../../../src/shared/types";

const TEST_NOTE: Note = {
  id: "note-1",
  jarId: "jar-1",
  text: "Go for a hike",
  style: "sticky",
  state: "pulled",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

afterEach(cleanup);

describe("PulledNote component", () => {
  it("renders the note text", () => {
    render(<PulledNote note={TEST_NOTE} onDiscard={vi.fn()} onReturn={vi.fn()} />);
    expect(screen.getByText("Go for a hike")).toBeDefined();
  });

  it("renders a link when URL is present", () => {
    const noteWithUrl = { ...TEST_NOTE, url: "https://example.com" };
    render(<PulledNote note={noteWithUrl} onDiscard={vi.fn()} onReturn={vi.fn()} />);
    const link = screen.getByRole("link");
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("https://example.com");
  });

  it("calls onDiscard with note id when discard button is clicked", () => {
    const onDiscard = vi.fn();
    render(<PulledNote note={TEST_NOTE} onDiscard={onDiscard} onReturn={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalledWith("note-1");
  });

  it("calls onReturn with note id when return button is clicked", () => {
    const onReturn = vi.fn();
    render(<PulledNote note={TEST_NOTE} onDiscard={vi.fn()} onReturn={onReturn} />);
    fireEvent.click(screen.getByRole("button", { name: /return/i }));
    expect(onReturn).toHaveBeenCalledWith("note-1");
  });
});
