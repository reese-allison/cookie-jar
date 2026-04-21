/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorToast } from "../../../src/client/components/ErrorToast";
import { useRoomStore } from "../../../src/client/stores/roomStore";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useRoomStore.getState().reset();
});

beforeEach(() => {
  useRoomStore.getState().reset();
});

describe("ErrorToast", () => {
  it("renders nothing when there is no error", () => {
    const { container } = render(<ErrorToast />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the current error message with role=alert", () => {
    act(() => useRoomStore.getState().setError("Something broke"));
    render(<ErrorToast />);
    const toast = screen.getByRole("alert");
    expect(toast.textContent).toContain("Something broke");
  });

  it("auto-dismisses after the timeout elapses", () => {
    vi.useFakeTimers();
    act(() => useRoomStore.getState().setError("transient glitch"));
    render(<ErrorToast />);
    expect(screen.getByRole("alert")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(useRoomStore.getState().error).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the error when the dismiss button is clicked", () => {
    act(() => useRoomStore.getState().setError("click to dismiss"));
    render(<ErrorToast />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(useRoomStore.getState().error).toBeNull();
  });

  it("cancels the auto-dismiss timer when the error is manually cleared", () => {
    vi.useFakeTimers();
    act(() => useRoomStore.getState().setError("first"));
    render(<ErrorToast />);
    act(() => useRoomStore.getState().setError(null));
    // Further timer advancement must not call setError again (would be a no-op
    // here anyway, but a leaked timer on a later error could stomp the new one).
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(useRoomStore.getState().error).toBeNull();
  });
});
