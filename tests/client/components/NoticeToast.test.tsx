/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeToast } from "../../../src/client/components/NoticeToast";
import { useRoomStore } from "../../../src/client/stores/roomStore";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useRoomStore.getState().reset();
});

beforeEach(() => {
  useRoomStore.getState().reset();
});

describe("NoticeToast", () => {
  it("renders nothing when there is no notice", () => {
    const { container } = render(<NoticeToast />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the current notice as a status (not an alert)", () => {
    act(() => useRoomStore.getState().setNotice("Copied!"));
    render(<NoticeToast />);
    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Copied!");
    // Success messages must not hijack the assertive error channel.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("auto-dismisses after the timeout elapses", () => {
    vi.useFakeTimers();
    act(() => useRoomStore.getState().setNotice("Copied!"));
    render(<NoticeToast />);
    expect(screen.getByRole("status")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(useRoomStore.getState().notice).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
