/**
 * Unit coverage for the per-pod grace-timer invariants. The e2e behavior
 * (room actually closes, rejoin preserves it) lives in configMatrix; this
 * file covers the bits a black-box test can't see: a second schedule
 * replaces rather than extends, cancel prevents a pending fire, and stop()
 * drains pending timers so shutdown doesn't leak them onto torn-down pools.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocketDeps } from "../../../src/server/socket/deps";
import { createLastLeaveGrace } from "../../../src/server/socket/lastLeaveGrace";
import { withEnv } from "../../helpers/withEnv";

// Minimal fake deps — only the stores lastLeaveGrace actually calls.
function makeDeps(memberCount: () => Promise<number>): SocketDeps {
  const stub = vi.fn().mockResolvedValue(undefined);
  return {
    presenceStore: {
      memberCount,
      clearRoom: stub,
      addMember: stub,
      addMemberIfUnderCap: stub,
      removeMember: stub,
      removeAndCount: stub,
      reconcile: stub,
      getMembers: stub,
      getMember: stub,
    } as unknown as SocketDeps["presenceStore"],
    sealedNotesStore: {
      clear: stub,
    } as unknown as SocketDeps["sealedNotesStore"],
    dedupStore: {} as SocketDeps["dedupStore"],
    kickBus: {} as SocketDeps["kickBus"],
    cacheBus: {} as SocketDeps["cacheBus"],
    roomStateCache: {} as SocketDeps["roomStateCache"],
    lastLeaveGrace: {} as SocketDeps["lastLeaveGrace"],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("lastLeaveGrace", () => {
  it("fires the close after the grace window elapses", async () => {
    await withEnv("LAST_LEAVE_GRACE_MS", "1000", async () => {
      const memberCount = vi.fn().mockResolvedValue(0);
      const grace = createLastLeaveGrace();
      grace.schedule({ deps: makeDeps(memberCount), roomId: "r1", jarId: "j1" });
      expect(memberCount).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(memberCount).toHaveBeenCalledWith("r1");
    });
  });

  it("cancel prevents a pending close from firing", async () => {
    await withEnv("LAST_LEAVE_GRACE_MS", "1000", async () => {
      const memberCount = vi.fn().mockResolvedValue(0);
      const grace = createLastLeaveGrace();
      grace.schedule({ deps: makeDeps(memberCount), roomId: "r1", jarId: "j1" });
      grace.cancel("r1");
      await vi.advanceTimersByTimeAsync(2000);
      expect(memberCount).not.toHaveBeenCalled();
    });
  });

  it("re-scheduling replaces the pending timer (does not extend)", async () => {
    // A rejoin-then-leave cycle must fire on the NEW deadline, not delay
    // indefinitely. Verify the old timer is cleared when a new one arrives.
    await withEnv("LAST_LEAVE_GRACE_MS", "1000", async () => {
      const memberCount = vi.fn().mockResolvedValue(0);
      const grace = createLastLeaveGrace();
      const deps = makeDeps(memberCount);
      grace.schedule({ deps, roomId: "r1", jarId: "j1" });
      // 500ms into the first timer, schedule again. Total wait should be
      // 500 + 1000 = 1500 from the start for the close to fire.
      await vi.advanceTimersByTimeAsync(500);
      grace.schedule({ deps, roomId: "r1", jarId: "j1" });
      await vi.advanceTimersByTimeAsync(999);
      expect(memberCount).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(memberCount).toHaveBeenCalledTimes(1);
    });
  });

  it("stop() drains all pending timers so shutdown doesn't fire them", async () => {
    await withEnv("LAST_LEAVE_GRACE_MS", "1000", async () => {
      const memberCount = vi.fn().mockResolvedValue(0);
      const grace = createLastLeaveGrace();
      const deps = makeDeps(memberCount);
      grace.schedule({ deps, roomId: "r1", jarId: "j1" });
      grace.schedule({ deps, roomId: "r2", jarId: "j2" });
      grace.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(memberCount).not.toHaveBeenCalled();
    });
  });

  it("skips close when presence is non-zero at fire time (rejoin on another pod)", async () => {
    await withEnv("LAST_LEAVE_GRACE_MS", "1000", async () => {
      const memberCount = vi.fn().mockResolvedValue(1);
      const deps = makeDeps(memberCount);
      const clearRoom = deps.presenceStore.clearRoom as ReturnType<typeof vi.fn>;
      const grace = createLastLeaveGrace();
      grace.schedule({ deps, roomId: "r1", jarId: "j1" });
      await vi.advanceTimersByTimeAsync(1000);
      // Re-check ran, but clearRoom did not — the room was resurrected.
      expect(memberCount).toHaveBeenCalledTimes(1);
      expect(clearRoom).not.toHaveBeenCalled();
    });
  });

  it("isolates rooms — cancel on r1 doesn't stop r2", async () => {
    await withEnv("LAST_LEAVE_GRACE_MS", "1000", async () => {
      const memberCount = vi.fn().mockResolvedValue(0);
      const grace = createLastLeaveGrace();
      const deps = makeDeps(memberCount);
      grace.schedule({ deps, roomId: "r1", jarId: "j1" });
      grace.schedule({ deps, roomId: "r2", jarId: "j2" });
      grace.cancel("r1");
      await vi.advanceTimersByTimeAsync(1000);
      expect(memberCount).toHaveBeenCalledTimes(1);
      expect(memberCount).toHaveBeenCalledWith("r2");
    });
  });
});
