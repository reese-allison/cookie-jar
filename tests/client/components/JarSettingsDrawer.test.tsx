/**
 * @vitest-environment jsdom
 *
 * Regression guard: editing the Name (or Label) field, then triggering any
 * other setting save, must NOT wipe the unsaved input. The drawer previously
 * re-synced local state from props whenever `name` or `appearance.label`
 * changed — so a note:state update for an *unrelated* field would clobber the
 * user's in-progress typing.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JarSettingsDrawer } from "../../../src/client/components/JarSettingsDrawer";

const baseProps = {
  open: true,
  onClose: vi.fn(),
  jarId: "jar-1",
  name: "Original Name",
  appearance: { label: "Original Label" },
  config: {
    noteVisibility: "open" as const,
    pullVisibility: "shared" as const,
    sealedRevealCount: 1,
    showAuthors: false,
    showPulledBy: false,
  },
  onSaved: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) } as Response)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("JarSettingsDrawer — unsaved edits", () => {
  it("keeps an in-progress Name edit when the appearance prop is updated by another save", () => {
    const { rerender } = render(<JarSettingsDrawer {...baseProps} />);

    // User types in the Name field but hasn't blurred yet.
    const inputs = screen.getAllByRole("textbox");
    const nameInput = inputs[0] as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Pending Name" } });
    expect(nameInput.value).toBe("Pending Name");

    // A separate save (e.g., toggling showAuthors on) completes — server
    // emits note:state, noteStore re-renders this drawer with a fresh
    // `appearance` object. The label hasn't changed here but the object
    // reference has (Redux/Zustand pattern).
    rerender(<JarSettingsDrawer {...baseProps} appearance={{ label: "Original Label" }} />);

    // Without the fix, the sync effect fires because the `appearance` prop
    // identity changed and `appearance.label` is read fresh — localName gets
    // clobbered back to the prop `name`.
    expect(nameInput.value).toBe("Pending Name");
  });

  it("keeps in-progress local edits even when a peer's edit changes appearance.label", () => {
    // Trade-off: to protect local unsaved typing, we do NOT live-sync peer
    // edits while the drawer is open. Peer edits appear next time the drawer
    // is opened. That's acceptable here because concurrent edits are rare and
    // losing unsaved typing is much more frustrating than a one-open staleness.
    const { rerender } = render(<JarSettingsDrawer {...baseProps} />);

    const inputs = screen.getAllByRole("textbox");
    const nameInput = inputs[0] as HTMLInputElement;
    const labelInput = inputs[1] as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Still Typing" } });

    rerender(<JarSettingsDrawer {...baseProps} appearance={{ label: "Peer's New Label" }} />);

    expect(nameInput.value).toBe("Still Typing");
    // Local label input is still the pre-peer value (it will refresh on reopen).
    expect(labelInput.value).toBe("Original Label");
  });

  it("does re-sync when the drawer is closed and reopened", () => {
    const { rerender } = render(<JarSettingsDrawer {...baseProps} />);
    const inputs = screen.getAllByRole("textbox");
    const nameInput = inputs[0] as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Never Saved" } });

    // Close the drawer — unsaved edit is discarded (expected behaviour).
    rerender(<JarSettingsDrawer {...baseProps} open={false} />);
    // Reopen with the same authoritative prop — we should see the server value.
    rerender(<JarSettingsDrawer {...baseProps} open={true} />);

    const reopenedName = (screen.getAllByRole("textbox")[0] as HTMLInputElement).value;
    expect(reopenedName).toBe("Original Name");
  });
});

describe("JarSettingsDrawer — sealed-reveal slider", () => {
  const sealedProps = {
    ...baseProps,
    config: { ...baseProps.config, noteVisibility: "sealed" as const, sealedRevealCount: 1 },
  };

  it("updates the visible slider + label during a drag without saving each step", () => {
    render(<JarSettingsDrawer {...sealedProps} />);
    const slider = screen.getByRole("slider");
    // Simulate a drag: browser fires change for each intermediate value.
    for (const v of [2, 3, 4, 5]) {
      fireEvent.change(slider, { target: { value: String(v) } });
    }
    expect((slider as HTMLInputElement).value).toBe("5");
    expect(screen.getByText(/Reveal at 5 pulls/)).toBeDefined();
    // No PATCH fired yet — the user hasn't committed.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("saves exactly once when the user releases the slider", () => {
    render(<JarSettingsDrawer {...sealedProps} />);
    const slider = screen.getByRole("slider");
    for (const v of [2, 3, 4, 5]) {
      fireEvent.change(slider, { target: { value: String(v) } });
    }
    fireEvent.pointerUp(slider);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetch as unknown as { mock: { calls: [[string, { body: string }]] } }).mock.calls[0][1].body,
    );
    expect(body.config.sealedRevealCount).toBe(5);
  });

  it("saves on keyboard-arrow release", () => {
    render(<JarSettingsDrawer {...sealedProps} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "3" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("doesn't save when release happens without a change", () => {
    render(<JarSettingsDrawer {...sealedProps} />);
    const slider = screen.getByRole("slider");
    fireEvent.pointerUp(slider);
    expect(fetch).not.toHaveBeenCalled();
  });
});
