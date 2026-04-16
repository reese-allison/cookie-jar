import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleTimeoutManager } from "../../../src/server/socket/idleTimeout";

describe("IdleTimeoutManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onTimeout after the specified duration", () => {
    const onTimeout = vi.fn();
    const manager = new IdleTimeoutManager();

    manager.start("room-1", 1, onTimeout); // 1 minute
    vi.advanceTimersByTime(60_000);

    expect(onTimeout).toHaveBeenCalledWith("room-1");
  });

  it("resets the timer on activity", () => {
    const onTimeout = vi.fn();
    const manager = new IdleTimeoutManager();

    manager.start("room-1", 1, onTimeout);
    vi.advanceTimersByTime(30_000); // 30s
    manager.resetActivity("room-1");
    vi.advanceTimersByTime(30_000); // another 30s (total 60s but reset at 30s)

    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000); // now 60s since reset
    expect(onTimeout).toHaveBeenCalledWith("room-1");
  });

  it("clears timeout when room is stopped", () => {
    const onTimeout = vi.fn();
    const manager = new IdleTimeoutManager();

    manager.start("room-1", 1, onTimeout);
    manager.stop("room-1");
    vi.advanceTimersByTime(120_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("handles multiple rooms independently", () => {
    const onTimeout = vi.fn();
    const manager = new IdleTimeoutManager();

    manager.start("room-1", 1, onTimeout);
    manager.start("room-2", 2, onTimeout); // 2 minutes

    vi.advanceTimersByTime(60_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith("room-1");

    vi.advanceTimersByTime(60_000);
    expect(onTimeout).toHaveBeenCalledTimes(2);
    expect(onTimeout).toHaveBeenCalledWith("room-2");
  });
});
