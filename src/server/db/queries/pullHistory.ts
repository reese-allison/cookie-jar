import type pg from "pg";

export interface PullHistoryEntry {
  id: string;
  jarId: string;
  noteId: string;
  noteText: string;
  pulledBy: string;
  roomId: string | null;
  pulledAt: string;
}

interface RecordPullInput {
  jarId: string;
  noteId: string;
  pulledBy: string;
  roomId?: string;
}

export async function recordPull(pool: pg.Pool, input: RecordPullInput): Promise<void> {
  await pool.query(
    `INSERT INTO pull_history (jar_id, note_id, pulled_by, room_id)
     VALUES ($1, $2, $3, $4)`,
    [input.jarId, input.noteId, input.pulledBy, input.roomId ?? null],
  );
}

export async function getHistory(
  pool: pg.Pool,
  jarId: string,
  limit = 100,
): Promise<PullHistoryEntry[]> {
  const { rows } = await pool.query(
    `SELECT ph.id, ph.jar_id, ph.note_id, n.text AS note_text,
            ph.pulled_by, ph.room_id, ph.pulled_at
     FROM pull_history ph
     JOIN notes n ON n.id = ph.note_id
     WHERE ph.jar_id = $1
     ORDER BY ph.pulled_at DESC
     LIMIT $2`,
    [jarId, limit],
  );
  return rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    jarId: row.jar_id as string,
    noteId: row.note_id as string,
    noteText: row.note_text as string,
    pulledBy: row.pulled_by as string,
    roomId: (row.room_id as string) ?? null,
    pulledAt: (row.pulled_at as Date).toISOString(),
  }));
}

export async function clearHistory(pool: pg.Pool, jarId: string): Promise<void> {
  await pool.query("DELETE FROM pull_history WHERE jar_id = $1", [jarId]);
}
