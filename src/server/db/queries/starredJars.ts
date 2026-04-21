import type { Jar, JarAppearance, JarConfig, RoomState } from "@shared/types";
import type pg from "pg";

export interface StarredJarActiveRoom {
  code: string;
  state: RoomState;
  createdAt: string;
}

export interface StarredJar extends Jar {
  activeRooms: StarredJarActiveRoom[];
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
    `SELECT j.*,
       COALESCE(
         (SELECT json_agg(json_build_object(
                   'code', r.code,
                   'state', r.state,
                   'createdAt', r.created_at
                 ) ORDER BY r.created_at DESC)
          FROM rooms r
          WHERE r.jar_id = j.id AND r.state != 'closed'),
         '[]'::json
       ) AS active_rooms
     FROM user_starred_jars s
     JOIN jars j ON j.id = s.jar_id
     WHERE s.user_id = $1
     ORDER BY s.starred_at DESC`,
    [userId],
  );
  return rows.map((row: Record<string, unknown>) => {
    const jar: Jar = {
      id: row.id as string,
      ownerId: row.owner_id as string,
      name: row.name as string,
      appearance: row.appearance as JarAppearance,
      config: row.config as JarConfig,
      isTemplate: row.is_template as boolean,
      isPublic: row.is_public as boolean,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
    const activeRooms = (row.active_rooms as StarredJarActiveRoom[]).map((r) => ({
      code: r.code,
      state: r.state,
      createdAt: r.createdAt,
    }));
    return { ...jar, activeRooms };
  });
}
