import { DEFAULT_IDLE_TIMEOUT_MINUTES, DEFAULT_LIMITS } from "@shared/constants";
import type { RoomState } from "@shared/types";
import { generateRoomCode } from "@shared/validation";
import type pg from "pg";

interface RoomRow {
  id: string;
  code: string;
  jarId: string;
  state: RoomState;
  maxParticipants: number;
  maxViewers: number;
  idleTimeoutMinutes: number;
  createdAt: string;
  closedAt: string | null;
}

interface CreateRoomInput {
  jarId: string;
  maxParticipants?: number;
  maxViewers?: number;
  idleTimeoutMinutes?: number;
}

function rowToRoom(row: Record<string, unknown>): RoomRow {
  return {
    id: row.id as string,
    code: row.code as string,
    jarId: row.jar_id as string,
    state: row.state as RoomState,
    maxParticipants: row.max_participants as number,
    maxViewers: row.max_viewers as number,
    idleTimeoutMinutes: row.idle_timeout_minutes as number,
    createdAt: (row.created_at as Date).toISOString(),
    closedAt: row.closed_at ? (row.closed_at as Date).toISOString() : null,
  };
}

export async function createRoom(pool: pg.Pool, input: CreateRoomInput): Promise<RoomRow> {
  const code = generateRoomCode();
  const { rows } = await pool.query(
    `INSERT INTO rooms (code, jar_id, max_participants, max_viewers, idle_timeout_minutes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      code,
      input.jarId,
      input.maxParticipants ?? DEFAULT_LIMITS.maxParticipants,
      input.maxViewers ?? DEFAULT_LIMITS.maxViewers,
      input.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES,
    ],
  );
  return rowToRoom(rows[0]);
}

export async function getRoomByCode(pool: pg.Pool, code: string): Promise<RoomRow | null> {
  const { rows } = await pool.query("SELECT * FROM rooms WHERE code = $1 AND state != 'closed'", [
    code,
  ]);
  return rows.length > 0 ? rowToRoom(rows[0]) : null;
}

export async function getRoomById(pool: pg.Pool, id: string): Promise<RoomRow | null> {
  const { rows } = await pool.query("SELECT * FROM rooms WHERE id = $1", [id]);
  return rows.length > 0 ? rowToRoom(rows[0]) : null;
}

export async function updateRoomState(
  pool: pg.Pool,
  roomId: string,
  state: RoomState,
): Promise<RoomRow | null> {
  const closedAt = state === "closed" ? new Date() : null;
  const { rows } = await pool.query(
    `UPDATE rooms SET state = $1, closed_at = $2 WHERE id = $3 RETURNING *`,
    [state, closedAt, roomId],
  );
  return rows.length > 0 ? rowToRoom(rows[0]) : null;
}

/** Active (non-closed) rooms for a jar. Used on delete to disconnect live sockets. */
export async function listActiveRoomsForJar(pool: pg.Pool, jarId: string): Promise<RoomRow[]> {
  const { rows } = await pool.query("SELECT * FROM rooms WHERE jar_id = $1 AND state != 'closed'", [
    jarId,
  ]);
  return rows.map(rowToRoom);
}
