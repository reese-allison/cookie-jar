import pool from "../db/pool";
import * as roomQueries from "../db/queries/rooms";
import { logger } from "../logger";
import { closeEmptyRoom } from "./closeEmptyRoom";
import type { SocketDeps } from "./deps";
import { fireAndForget } from "./fireAndForget";

/**
 * How long to wait after the last member leaves before actually closing the
 * room in the DB. A page refresh, a tab sleep/wake, or a transient network
 * blip all look like "the last member left" from the server's side because
 * the socket drops before it can come back. Holding the room open for a
 * short grace period lets `/ROOMCODE` survive those.
 *
 * Kept small so an owner who closes the tab doesn't leave a ghost room on
 * their "My Jars" list for long. The zombie-room sweep (5 min cadence,
 * 30 s grace) catches any stragglers. Overridable via env so tests can set
 * 0 and keep their runtime bounded.
 */
const DEFAULT_GRACE_MS = 15_000;
function graceMs(): number {
  const raw = process.env.LAST_LEAVE_GRACE_MS;
  if (raw === undefined) return DEFAULT_GRACE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_GRACE_MS;
}

export interface LastLeaveGrace {
  schedule(opts: { deps: SocketDeps; roomId: string; jarId: string | null }): void;
  /** Cancel any pending close for this room (someone rejoined). No-op if none. */
  cancel(roomId: string): void;
  /**
   * Drop all pending timers without running them. Called from shutdown so
   * grace closes don't fire mid-drain against already-closed pools.
   */
  stop(): void;
}

/**
 * Per-pod timers for deferred last-leave closes. Cross-pod coordination is
 * handled by `closeRoomIfOpen`'s conditional SQL — two pods racing to close
 * the same room see one UPDATE succeed and the other no-op.
 */
export function createLastLeaveGrace(): LastLeaveGrace {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  function schedule(opts: { deps: SocketDeps; roomId: string; jarId: string | null }): void {
    const { deps, roomId, jarId } = opts;
    // A brief "rejoin then leave again" replaces, rather than extends, the
    // original deadline — the fresh grace window starts from the new leave.
    const existing = pending.get(roomId);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(() => {
      pending.delete(roomId);
      fireAndForget(runClose(deps, roomId, jarId), "lastLeaveGrace.runClose");
    }, graceMs());
    handle.unref?.();
    pending.set(roomId, handle);
  }

  function cancel(roomId: string): void {
    const existing = pending.get(roomId);
    if (!existing) return;
    clearTimeout(existing);
    pending.delete(roomId);
  }

  function stop(): void {
    for (const h of pending.values()) clearTimeout(h);
    pending.clear();
  }

  return { schedule, cancel, stop };
}

async function runClose(deps: SocketDeps, roomId: string, jarId: string | null): Promise<void> {
  // Re-check presence — a rejoin on another pod bumped the hash and our
  // in-process cancel never reached us. The DB UPDATE is also conditional
  // (closeRoomIfOpen), so even this check losing a narrow race is harmless:
  // the second writer just no-ops.
  const count = await deps.presenceStore.memberCount(roomId);
  if (count > 0) {
    logger.debug({ roomId, count }, "lastLeaveGrace: rejoin detected, skipping close");
    return;
  }
  const closed = await roomQueries.closeRoomIfOpen(pool, roomId);
  if (!closed) {
    logger.debug({ roomId }, "lastLeaveGrace: room already closed, skipping cleanup");
    return;
  }
  await closeEmptyRoom(deps, roomId, jarId);
}
