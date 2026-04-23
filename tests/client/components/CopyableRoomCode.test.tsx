/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyableRoomCode } from "../../../src/client/components/CopyableRoomCode";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
});

describe("CopyableRoomCode", () => {
  it("renders the code", () => {
    render(<CopyableRoomCode code="ABCDEF" />);
    expect(screen.getByText("ABCDEF")).toBeDefined();
  });

  it("copies the full room URL to the clipboard and shows Copied on click", async () => {
    render(<CopyableRoomCode code="ABCDEF" />);
    fireEvent.click(screen.getByRole("button", { name: /copy room link/i }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/ABCDEF`);
    await waitFor(() => {
      expect(screen.getByText(/copied/i)).toBeDefined();
    });
  });

  it("hides the Copied indicator after 1.5s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<CopyableRoomCode code="ABCDEF" />);
      fireEvent.click(screen.getByRole("button", { name: /copy room link/i }));
      await waitFor(() => expect(screen.getByText(/copied/i)).toBeDefined());
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByText(/copied/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
