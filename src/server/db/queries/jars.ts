import type { Jar, JarAppearance, JarConfig, RoomState } from "@shared/types";
import { generateRoomCode } from "@shared/validation";
import type pg from "pg";
import type { Queryable } from "../transaction";
import { withTransaction } from "../transaction";

// The schema.sql inline `share_code TEXT NOT NULL UNIQUE` is auto-named by
// Postgres as `jars_share_code_key`; the migration adds a separately-named
// `jars_share_code_unique`. Both names are real possibilities depending on
// whether a deployment was bootstrapped from schema.sql (fresh CI / Fly)
// or migrated from an older schema (existing dev / prod). Match BOTH so a
// 23505 from either is correctly identified as a retryable collision.
// TODO: A follow-up migration could rename to converge; until then, this
// list is the source of truth.
const JAR_SHARE_CODE_UNIQUE_CONSTRAINTS = new Set([
  "jars_share_code_unique",
  "jars_share_code_key",
]);
const SHARE_CODE_COLLISION_RETRIES = 5;

function constraintOf(err: unknown): string | undefined {
  const e = err as { code?: string; constraint?: string };
  if (e.code !== "23505") return undefined;
  return e.constraint;
}

function isShareCodeCollision(err: unknown): boolean {
  const c = constraintOf(err);
  return c !== undefined && JAR_SHARE_CODE_UNIQUE_CONSTRAINTS.has(c);
}

interface ActiveRoomSummary {
  id: string;
  state: RoomState;
  createdAt: string;
}

interface OwnedJarWithRooms extends Jar {
  activeRooms: ActiveRoomSummary[];
}

// Appearance + config are stored as JSONB with DB-side defaults; PATCH and
// POST callers may supply only the fields they mean to set. Partial<> keeps
// the sanitizer output (which emits only validated keys) assignable here.
interface CreateJarInput {
  ownerId: string;
  name: string;
  appearance?: Partial<JarAppearance>;
  config?: Partial<JarConfig>;
  isTemplate?: boolean;
  isPublic?: boolean;
}

interface UpdateJarInput {
  name?: string;
  appearance?: Partial<JarAppearance>;
  config?: Partial<JarConfig>;
  isPublic?: boolean;
}

function rowToJar(row: Record<string, unknown>): Jar {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    name: row.name as string,
    appearance: row.appearance as JarAppearance,
    config: row.config as JarConfig,
    shareCode: row.share_code as string,
    isTemplate: row.is_template as boolean,
    isPublic: row.is_public as boolean,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function createJar(db: Queryable, input: CreateJarInput): Promise<Jar> {
  // share_code is NOT NULL; generate at the app layer so the alphabet and
  // length policy lives in shared/constants (ROOM_CODE_CHARS / _LENGTH) and
  // can be tweaked in one place. Collisions are vanishingly rare at 32^7
  // ≈ 34B; the retry budget covers the pathological case without spinning.
  for (let attempt = 0; attempt < SHARE_CODE_COLLISION_RETRIES; attempt++) {
    const shareCode = generateRoomCode();
    try {
      const { rows } = await db.query(
        `INSERT INTO jars (owner_id, name, appearance, config, share_code, is_template, is_public)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.ownerId,
          input.name,
          JSON.stringify(input.appearance ?? {}),
          JSON.stringify(input.config ?? {}),
          shareCode,
          input.isTemplate ?? false,
          input.isPublic ?? false,
        ],
      );
      return rowToJar(rows[0]);
    } catch (err) {
      if (isShareCodeCollision(err) && attempt < SHARE_CODE_COLLISION_RETRIES - 1) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("createJar exhausted share_code collision retries");
}

export async function getJarById(pool: pg.Pool, id: string): Promise<Jar | null> {
  const { rows } = await pool.query("SELECT * FROM jars WHERE id = $1", [id]);
  return rows.length > 0 ? rowToJar(rows[0]) : null;
}

export async function getJarByShareCode(pool: pg.Pool, shareCode: string): Promise<Jar | null> {
  const { rows } = await pool.query("SELECT * FROM jars WHERE share_code = $1", [shareCode]);
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
                   'id', r.id,
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
        id: string;
        state: RoomState;
        createdAt: string;
      }>
    ).map((r) => ({ id: r.id, state: r.state, createdAt: r.createdAt }));
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
