import type { Note, NoteState, NoteStyle } from "@shared/types";
import type pg from "pg";

interface CreateNoteInput {
  jarId: string;
  text: string;
  url?: string;
  style: NoteStyle;
  authorId?: string;
}

interface UpdateNoteInput {
  text?: string;
  url?: string;
}

function rowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    jarId: row.jar_id as string,
    text: row.text as string,
    url: (row.url as string) ?? undefined,
    style: row.style as NoteStyle,
    state: row.state as NoteState,
    authorId: (row.author_id as string) ?? undefined,
    pulledBy: (row.pulled_by as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function createNote(pool: pg.Pool, input: CreateNoteInput): Promise<Note> {
  const { rows } = await pool.query(
    `INSERT INTO notes (jar_id, text, url, style, author_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.jarId, input.text, input.url ?? null, input.style, input.authorId],
  );
  return rowToNote(rows[0]);
}

export async function listNotesByJar(
  pool: pg.Pool,
  jarId: string,
  state?: NoteState,
): Promise<Note[]> {
  if (state) {
    const { rows } = await pool.query(
      "SELECT * FROM notes WHERE jar_id = $1 AND state = $2 ORDER BY created_at",
      [jarId, state],
    );
    return rows.map(rowToNote);
  }
  const { rows } = await pool.query("SELECT * FROM notes WHERE jar_id = $1 ORDER BY created_at", [
    jarId,
  ]);
  return rows.map(rowToNote);
}

export async function updateNoteState(
  pool: pg.Pool,
  noteId: string,
  state: NoteState,
): Promise<Note | null> {
  const { rows } = await pool.query(
    `UPDATE notes SET state = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [state, noteId],
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function updateNoteStateIfInJar(
  pool: pg.Pool,
  noteId: string,
  jarId: string,
  state: NoteState,
): Promise<Note | null> {
  const { rows } = await pool.query(
    `UPDATE notes SET state = $1, updated_at = now() WHERE id = $2 AND jar_id = $3 RETURNING *`,
    [state, noteId, jarId],
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function updateNote(
  pool: pg.Pool,
  noteId: string,
  input: UpdateNoteInput,
): Promise<Note | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.text !== undefined) {
    sets.push(`text = $${paramIndex++}`);
    values.push(input.text);
  }
  if (input.url !== undefined) {
    sets.push(`url = $${paramIndex++}`);
    values.push(input.url);
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = now()`);
  values.push(noteId);

  const { rows } = await pool.query(
    `UPDATE notes SET ${sets.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function pullRandomNote(
  pool: pg.Pool,
  jarId: string,
  pulledBy?: string,
): Promise<Note | null> {
  const { rows } = await pool.query(
    `UPDATE notes
     SET state = 'pulled', pulled_by = $2, updated_at = now()
     WHERE id = (
       SELECT id FROM notes
       WHERE jar_id = $1 AND state = 'in_jar'
       ORDER BY random()
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [jarId, pulledBy ?? null],
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function getPullCounts(pool: pg.Pool, jarId: string): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    "SELECT pulled_by, count(*)::int AS count FROM notes WHERE jar_id = $1 AND state = 'pulled' AND pulled_by IS NOT NULL GROUP BY pulled_by",
    [jarId],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.pulled_by as string] = row.count as number;
  }
  return counts;
}

export async function countNotesByState(
  pool: pg.Pool,
  jarId: string,
  state: NoteState,
): Promise<number> {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM notes WHERE jar_id = $1 AND state = $2",
    [jarId, state],
  );
  return rows[0].count;
}

export async function bulkCreateNotes(
  pool: pg.Pool,
  jarId: string,
  texts: string[],
  style: NoteStyle = "sticky",
): Promise<number> {
  const filtered = texts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (filtered.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;

  for (const text of filtered) {
    placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
    values.push(jarId, text, style);
  }

  await pool.query(
    `INSERT INTO notes (jar_id, text, style) VALUES ${placeholders.join(", ")}`,
    values,
  );
  return filtered.length;
}

export async function deleteNote(pool: pg.Pool, noteId: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM notes WHERE id = $1", [noteId]);
  return (rowCount ?? 0) > 0;
}
