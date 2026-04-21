import type { Note, NoteState, NoteStyle } from "@shared/types";
import type pg from "pg";
import type { Queryable } from "../transaction";

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
    authorDisplayName: (row.author_display_name as string) ?? undefined,
    pulledBy: (row.pulled_by as string) ?? undefined,
    pulledByUserId: (row.pulled_by_user_id as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

// SELECT fragment that joins the author's display name so the client can
// render "Written by …" when the jar has showAuthors enabled. LEFT JOIN keeps
// author-less rows (seeded templates, cloned jars) working unchanged.
const SELECT_NOTE_WITH_AUTHOR = `
  SELECT n.*, u.display_name AS author_display_name
  FROM notes n
  LEFT JOIN users u ON u.id = n.author_id
`;

/**
 * Wrap a write statement (INSERT/UPDATE ... RETURNING *) as a CTE and join
 * users so callers get author_display_name alongside the row, saving a second
 * round-trip. Every mutating query here uses the same shape; this helper keeps
 * them from drifting.
 */
function withAuthorJoin(writeCte: string): string {
  return `WITH cte AS (${writeCte})
    SELECT cte.*, u.display_name AS author_display_name
    FROM cte LEFT JOIN users u ON u.id = cte.author_id`;
}

export async function createNote(pool: pg.Pool, input: CreateNoteInput): Promise<Note> {
  const { rows } = await pool.query(
    withAuthorJoin(`
      INSERT INTO notes (jar_id, text, url, style, author_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `),
    [input.jarId, input.text, input.url ?? null, input.style, input.authorId],
  );
  return rowToNote(rows[0]);
}

export async function getNoteById(pool: pg.Pool, noteId: string): Promise<Note | null> {
  const { rows } = await pool.query(`${SELECT_NOTE_WITH_AUTHOR} WHERE n.id = $1`, [noteId]);
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function listNotesByJar(
  pool: pg.Pool,
  jarId: string,
  state?: NoteState,
): Promise<Note[]> {
  if (state) {
    const { rows } = await pool.query(
      `${SELECT_NOTE_WITH_AUTHOR} WHERE n.jar_id = $1 AND n.state = $2 ORDER BY n.created_at`,
      [jarId, state],
    );
    return rows.map(rowToNote);
  }
  const { rows } = await pool.query(
    `${SELECT_NOTE_WITH_AUTHOR} WHERE n.jar_id = $1 ORDER BY n.created_at`,
    [jarId],
  );
  return rows.map(rowToNote);
}

export async function updateNoteState(
  pool: pg.Pool,
  noteId: string,
  state: NoteState,
): Promise<Note | null> {
  const { rows } = await pool.query(
    withAuthorJoin(`UPDATE notes SET state = $1, updated_at = now() WHERE id = $2 RETURNING *`),
    [state, noteId],
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function updateNoteStateIfInJar(
  pool: pg.Pool,
  noteId: string,
  jarId: string,
  state: NoteState,
  fromState?: NoteState | NoteState[],
): Promise<Note | null> {
  // Restrict the source state so note:return can't resurrect a discarded note
  // into the jar, and note:discard can't act on something that was never
  // pulled. When `fromState` is omitted the update is unconditional (used by
  // paths that have already verified state another way).
  if (fromState === undefined) {
    const { rows } = await pool.query(
      withAuthorJoin(`
        UPDATE notes SET state = $1, updated_at = now()
        WHERE id = $2 AND jar_id = $3
        RETURNING *
      `),
      [state, noteId, jarId],
    );
    return rows.length > 0 ? rowToNote(rows[0]) : null;
  }
  const allowed = Array.isArray(fromState) ? fromState : [fromState];
  const { rows } = await pool.query(
    withAuthorJoin(`
      UPDATE notes SET state = $1, updated_at = now()
      WHERE id = $2 AND jar_id = $3 AND state = ANY($4::text[])
      RETURNING *
    `),
    [state, noteId, jarId, allowed],
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
    withAuthorJoin(`UPDATE notes SET ${sets.join(", ")} WHERE id = $${paramIndex} RETURNING *`),
    values,
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function pullRandomNote(
  db: Queryable,
  jarId: string,
  pulledBy?: string,
  pulledByUserId?: string,
): Promise<Note | null> {
  const { rows } = await db.query(
    withAuthorJoin(`
      UPDATE notes
      SET state = 'pulled', pulled_by = $2, pulled_by_user_id = $3, updated_at = now()
      WHERE id = (
        SELECT id FROM notes
        WHERE jar_id = $1 AND state = 'in_jar'
        ORDER BY random()
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `),
    [jarId, pulledBy ?? null, pulledByUserId ?? null],
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
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

/**
 * Flip every "pulled" note belonging to a specific user back to the target
 * state (usually "in_jar" to recycle or "discarded" to burn them). Matches
 * by pulled_by_user_id when the leaver is authed, otherwise by display name.
 * Returns the ids of rows actually updated so the caller can broadcast.
 */
export async function transitionPulledNotesFor(
  pool: pg.Pool,
  jarId: string,
  nextState: NoteState,
  by: { userId?: string | null; displayName?: string | null },
): Promise<string[]> {
  // Prefer user-id match when we have it — handles the case where two users
  // share a display name. Fall back to name match for anonymous pulls or
  // legacy rows pre-migration. Each branch passes only the placeholders its
  // query actually references; sending an unreferenced param trips PG's
  // "could not determine data type of parameter" planner check.
  if (by.userId) {
    const { rows } = await pool.query(
      `UPDATE notes
         SET state = $1, updated_at = now()
         WHERE jar_id = $2
           AND state = 'pulled'
           AND (
             pulled_by_user_id = $3::uuid
             OR (pulled_by_user_id IS NULL AND pulled_by = $4)
           )
         RETURNING id`,
      [nextState, jarId, by.userId, by.displayName ?? null],
    );
    return rows.map((r) => r.id as string);
  }
  const { rows } = await pool.query(
    `UPDATE notes
       SET state = $1, updated_at = now()
       WHERE jar_id = $2
         AND state = 'pulled'
         AND pulled_by_user_id IS NULL
         AND pulled_by = $3
       RETURNING id`,
    [nextState, jarId, by.displayName ?? null],
  );
  return rows.map((r) => r.id as string);
}

/**
 * Flip every "pulled" note in a jar to the target state in one statement.
 * When returning, the puller identity is cleared so the notes look untouched
 * on the next pull. Returns the ids that moved — callers use them to emit
 * per-note `note:returned` / `note:discarded` broadcasts.
 */
export async function bulkTransitionPulled(
  pool: pg.Pool,
  jarId: string,
  nextState: "in_jar" | "discarded",
): Promise<string[]> {
  const returning = nextState === "in_jar";
  const sql = returning
    ? `UPDATE notes
         SET state = 'in_jar', pulled_by = NULL, pulled_by_user_id = NULL, updated_at = now()
         WHERE jar_id = $1 AND state = 'pulled'
         RETURNING id`
    : `UPDATE notes
         SET state = 'discarded', updated_at = now()
         WHERE jar_id = $1 AND state = 'pulled'
         RETURNING id`;
  const { rows } = await pool.query(sql, [jarId]);
  return rows.map((r) => r.id as string);
}

/**
 * Kept as a thin wrapper for the idle-close path so existing callers don't
 * change. New code should call `bulkTransitionPulled` directly.
 */
export async function resetPulledNotesForJar(pool: pg.Pool, jarId: string): Promise<number> {
  const ids = await bulkTransitionPulled(pool, jarId, "in_jar");
  return ids.length;
}
