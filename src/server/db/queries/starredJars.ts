import type { Jar } from "@shared/types";
import type pg from "pg";
import { ACTIVE_ROOMS_SUBQUERY, type ActiveRoomSummary, rowToJarWithActiveRooms } from "./jars";

interface StarredJar extends Jar {
  activeRooms: ActiveRoomSummary[];
}

/** Upsert — starring a jar you've already starred is a no-op (refreshes timestamp). */
export async function starJar(pool: pg.Pool, userId: string, jarId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_starred_jars (user_id, jar_id) VALUES ($1, $2)
     ON CONFLICT (user_id, jar_id) DO UPDATE SET starred_at = now()`,
    [userId, jarId],
  );
}

/** Remove a star. Silent no-op when the row doesn't exist. */
export async function unstarJar(pool: pg.Pool, userId: string, jarId: string): Promise<void> {
  await pool.query(`DELETE FROM user_starred_jars WHERE user_id = $1 AND jar_id = $2`, [
    userId,
    jarId,
  ]);
}

export async function isStarred(pool: pg.Pool, userId: string, jarId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM user_starred_jars WHERE user_id = $1 AND jar_id = $2 LIMIT 1`,
    [userId, jarId],
  );
  return rows.length > 0;
}

/** Return the jar ids this user has starred, newest first. */
export async function listStarredJarIds(pool: pg.Pool, userId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT jar_id FROM user_starred_jars WHERE user_id = $1 ORDER BY starred_at DESC`,
    [userId],
  );
  return rows.map((r) => r.jar_id as string);
}

/**
 * Return every jar this user has starred, along with any non-closed rooms.
 * Jars the user has since lost access to stay in the list — they render as
 * tombstones in the UI and the caller filters for display. Join attempts are
 * blocked by canAccessJar / room:join's own gate.
 */
export async function listStarredJarsWithRooms(
  pool: pg.Pool,
  userId: string,
): Promise<StarredJar[]> {
  const { rows } = await pool.query(
    `SELECT j.*, ${ACTIVE_ROOMS_SUBQUERY}
     FROM user_starred_jars s
     JOIN jars j ON j.id = s.jar_id
     WHERE s.user_id = $1
     ORDER BY s.starred_at DESC`,
    [userId],
  );
  return rows.map(rowToJarWithActiveRooms);
}
