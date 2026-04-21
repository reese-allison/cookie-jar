import type pg from "pg";
import { logger } from "../logger";
import type { PresenceStore } from "./presenceStore";

const DEFAULT_MAX_PER_RUN = 200;

/**
 * Close any room whose DB state isn't 'closed' but has zero presence in
 * Redis — leftovers from pre-`close-on-last-leave` versions, pod crashes
 * mid-session, or the rare case where the close handler failed silently.
 *
 * The grace period prevents a race with concurrent room creation: a freshly-
 * inserted room may legitimately have presence=0 for a few seconds while the
 * client is still connecting. Anything older than `graceSeconds` that's
 * still empty is genuinely abandoned.
 *
 * Returns the number of rooms closed. Safe to call from multiple pods —
 * UPDATE is idempotent and the second-place pod's UPDATE is a no-op.
 *
 * `maxPerRun` caps how many rooms one invocation processes, so a backlog
 * (thousands of zombies after a bad deploy) doesn't translate into an
 * equally long chain of Redis + DB round-trips. The next tick picks up the
 * remainder.
 */
export async function closeZombieRooms(
  pool: pg.Pool,
  presenceStore: PresenceStore,
  graceSeconds = 30,
  maxPerRun = DEFAULT_MAX_PER_RUN,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM rooms
     WHERE state != 'closed'
       AND created_at < now() - make_interval(secs => $1::int)
     LIMIT $2`,
    [graceSeconds, maxPerRun],
  );
  let closed = 0;
  for (const row of rows) {
    const count = await presenceStore.memberCount(row.id);
    if (count !== 0) continue;
    // Re-check presence right before the UPDATE so a user who joined in the
    // window between SELECT and now doesn't get their room killed under them.
    // Not a full lock — a join that lands in the few ms between this check
    // and the UPDATE can still be bulldozed — but the client auto-rejoins on
    // `room:error`, and the idle-close path owns the authoritative teardown.
    const recheck = await presenceStore.memberCount(row.id);
    if (recheck !== 0) continue;
    const result = await pool.query(
      `UPDATE rooms SET state = 'closed', closed_at = now()
       WHERE id = $1 AND state != 'closed'`,
      [row.id],
    );
    if ((result.rowCount ?? 0) > 0) closed++;
  }
  if (closed > 0) {
    logger.info({ closed }, "closed zombie rooms with no Redis presence");
  }
  return closed;
}
