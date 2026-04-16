import type { Jar, JarAppearance, JarConfig } from "@shared/types";
import type pg from "pg";

interface CreateJarInput {
  ownerId: string;
  name: string;
  appearance: JarAppearance;
  config: JarConfig;
}

interface UpdateJarInput {
  name?: string;
  appearance?: JarAppearance;
  config?: JarConfig;
}

function rowToJar(row: Record<string, unknown>): Jar {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    name: row.name as string,
    appearance: row.appearance as JarAppearance,
    config: row.config as JarConfig,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function createJar(pool: pg.Pool, input: CreateJarInput): Promise<Jar> {
  const { rows } = await pool.query(
    `INSERT INTO jars (owner_id, name, appearance, config)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.ownerId, input.name, JSON.stringify(input.appearance), JSON.stringify(input.config)],
  );
  return rowToJar(rows[0]);
}

export async function getJarById(pool: pg.Pool, id: string): Promise<Jar | null> {
  const { rows } = await pool.query("SELECT * FROM jars WHERE id = $1", [id]);
  return rows.length > 0 ? rowToJar(rows[0]) : null;
}

export async function listJarsByOwner(pool: pg.Pool, ownerId: string): Promise<Jar[]> {
  const { rows } = await pool.query(
    "SELECT * FROM jars WHERE owner_id = $1 ORDER BY created_at DESC",
    [ownerId],
  );
  return rows.map(rowToJar);
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
  if (input.appearance !== undefined) {
    sets.push(`appearance = $${paramIndex++}`);
    values.push(JSON.stringify(input.appearance));
  }
  if (input.config !== undefined) {
    sets.push(`config = $${paramIndex++}`);
    values.push(JSON.stringify(input.config));
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
