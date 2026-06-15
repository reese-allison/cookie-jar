/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PulledNote } from "../../../src/client/components/PulledNote";
import { useRoomStore } from "../../../src/client/stores/roomStore";
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

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  useRoomStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useRoomStore.getState().reset();
});

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

  it("renders a copy button for the note", () => {
    render(<PulledNote note={TEST_NOTE} onDiscard={vi.fn()} onReturn={vi.fn()} />);
    expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
  });

  it("copies the note body text — not the URL — to the clipboard", () => {
    const noteWithUrl = { ...TEST_NOTE, url: "https://example.com" };
    render(<PulledNote note={noteWithUrl} onDiscard={vi.fn()} onReturn={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("Go for a hike");
    expect(writeText).not.toHaveBeenCalledWith("https://example.com");
  });

  it("shows a 'Copied!' toast notice after a successful copy", async () => {
    render(<PulledNote note={TEST_NOTE} onDiscard={vi.fn()} onReturn={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() => expect(useRoomStore.getState().notice).toBe("Copied!"));
  });

  it("renders the action buttons as icons (svg) while keeping their accessible labels", () => {
    render(<PulledNote note={TEST_NOTE} onDiscard={vi.fn()} onReturn={vi.fn()} />);
    for (const name of [/copy/i, /return/i, /discard/i]) {
      const btn = screen.getByRole("button", { name });
      expect(btn.querySelector("svg")).not.toBeNull();
      expect(btn.textContent?.trim()).toBe("");
    }
  });

  it("has accessible buttons that can be focused with keyboard", () => {
    render(<PulledNote note={TEST_NOTE} onDiscard={vi.fn()} onReturn={vi.fn()} />);
    const returnBtn = screen.getByRole("button", { name: /return/i });
    const discardBtn = screen.getByRole("button", { name: /discard/i });
    // Buttons are natively focusable and keyboard-operable
    expect(returnBtn.tabIndex).not.toBe(-1);
    expect(discardBtn.tabIndex).not.toBe(-1);
  });
});
