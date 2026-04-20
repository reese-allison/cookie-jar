import type { Jar, JarAppearance, JarConfig, RoomState } from "@shared/types";
import type pg from "pg";
import type { Queryable } from "../transaction";
import { withTransaction } from "../transaction";

export interface ActiveRoomSummary {
  code: string;
  state: RoomState;
  createdAt: string;
}

export interface OwnedJarWithRooms extends Jar {
  activeRooms: ActiveRoomSummary[];
}

interface CreateJarInput {
  ownerId: string;
  name: string;
  appearance?: JarAppearance;
  config?: JarConfig;
  isTemplate?: boolean;
  isPublic?: boolean;
}

interface UpdateJarInput {
  name?: string;
  appearance?: JarAppearance;
  config?: JarConfig;
  isPublic?: boolean;
}

function rowToJar(row: Record<string, unknown>): Jar {
  return {
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
}

export async function createJar(db: Queryable, input: CreateJarInput): Promise<Jar> {
  const { rows } = await db.query(
    `INSERT INTO jars (owner_id, name, appearance, config, is_template, is_public)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.ownerId,
      input.name,
      JSON.stringify(input.appearance ?? {}),
      JSON.stringify(input.config ?? {}),
      input.isTemplate ?? false,
      input.isPublic ?? false,
    ],
  );
  return rowToJar(rows[0]);
}

export async function getJarById(pool: pg.Pool, id: string): Promise<Jar | null> {
  const { rows } = await pool.query("SELECT * FROM jars WHERE id = $1", [id]);
  return rows.length > 0 ? rowToJar(rows[0]) : null;
}

export async function listJarsByOwner(
  pool: pg.Pool,
  ownerId: string,
  opts: { includePrivate?: boolean } = {},
): Promise<Jar[]> {
  // A public list request only returns explicitly-shared jars so enumerating
  // another user's private collection with just their UUID isn't possible.
  const filter = opts.includePrivate ? "" : " AND is_public = true";
  const { rows } = await pool.query(
    `SELECT * FROM jars WHERE owner_id = $1${filter} ORDER BY created_at DESC`,
    [ownerId],
  );
  return rows.map(rowToJar);
}

export async function listOwnedJarsWithRooms(
  pool: pg.Pool,
  ownerId: string,
): Promise<OwnedJarWithRooms[]> {
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
     FROM jars j
     WHERE j.owner_id = $1
     ORDER BY j.created_at DESC`,
    [ownerId],
  );
  return rows.map((row) => {
    const jar = rowToJar(row);
    const activeRooms = (
      row.active_rooms as Array<{
        code: string;
        state: RoomState;
        createdAt: string;
      }>
    ).map((r) => ({ code: r.code, state: r.state, createdAt: r.createdAt }));
    return { ...jar, activeRooms };
  });
}

export async function listTemplates(pool: pg.Pool): Promise<Jar[]> {
  const { rows } = await pool.query("SELECT * FROM jars WHERE is_template = true ORDER BY name");
  return rows.map(rowToJar);
}

export async function cloneJar(
  pool: pg.Pool,
  sourceJarId: string,
  newOwnerId: string,
): Promise<Jar | null> {
  const source = await getJarById(pool, sourceJarId);
  if (!source) return null;

  return withTransaction(pool, async (client) => {
    const cloned = await createJar(client, {
      ownerId: newOwnerId,
      name: source.name,
      appearance: source.appearance,
      config: source.config,
    });

    await client.query(
      `INSERT INTO notes (jar_id, text, url, style, state)
       SELECT $1, text, url, style, 'in_jar'
       FROM notes WHERE jar_id = $2 AND state != 'discarded'`,
      [cloned.id, sourceJarId],
    );

    return cloned;
  });
}

export async function updateJar(
  pool: pg.Pool,
  id: string,
  input: UpdateJarInput,
): Promise<Jar | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  // `||` is Postgres's JSONB concat — shallow merge. A PATCH with just
  // { label: "x" } keeps the existing openedImageUrl / soundPack / etc.
  // Clients that want to clear a field must send it explicitly as null or "".
  if (input.appearance !== undefined) {
    sets.push(`appearance = appearance || $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(input.appearance));
  }
  if (input.config !== undefined) {
    sets.push(`config = config || $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(input.config));
  }
  if (input.isPublic !== undefined) {
    sets.push(`is_public = $${paramIndex++}`);
    values.push(input.isPublic);
  }

  if (sets.length === 0) return getJarById(pool, id);

  sets.push(`updated_at = now()`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE jars SET ${sets.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return rows.length > 0 ? rowToJar(rows[0]) : null;
}

export async function deleteJar(pool: pg.Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM jars WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}
