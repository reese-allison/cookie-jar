import { DEFAULT_IDLE_TIMEOUT_MINUTES, DEFAULT_LIMITS } from "@shared/constants";
import type { RoomState } from "@shared/types";
import type pg from "pg";

interface RoomRow {
  id: string;
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
    jarId: row.jar_id as string,
    state: row.state as RoomState,
    maxParticipants: row.max_participants as number,
    maxViewers: row.max_viewers as number,
    idleTimeoutMinutes: row.idle_timeout_minutes as number,
    createdAt: (row.created_at as Date).toISOString(),
    closedAt: row.closed_at ? (row.closed_at as Date).toISOString() : null,
  };
}

export const ROOM_ACTIVE_PER_JAR_CONSTRAINT = "idx_rooms_active_per_jar";

function constraintOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { code?: string; constraint?: string };
  if (e.code !== "23505") return undefined;
  return e.constraint;
}

export async function createRoom(pool: pg.Pool, input: CreateRoomInput): Promise<RoomRow> {
  const { rows } = await pool.query(
    `INSERT INTO rooms (jar_id, max_participants, max_viewers, idle_timeout_minutes)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      input.jarId,
      input.maxParticipants ?? DEFAULT_LIMITS.maxParticipants,
      input.maxViewers ?? DEFAULT_LIMITS.maxViewers,
      input.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES,
    ],
  );
  return rowToRoom(rows[0]);
}

export function isRoomConstraintViolation(err: unknown, constraint: string): boolean {
  return constraintOf(err) === constraint;
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

/**
 * Transition a room to `closed` only if it is not already closed. Returns true
 * when this call flipped the row, false if another pod/timer got there first.
 *
 * The idempotent check lives in SQL (`WHERE state != 'closed'`) so a re-check
 * in app code between presence==0 and the UPDATE can't be bulldozed by a
 * concurrent rejoin that resurrected the room — the second writer's UPDATE
 * becomes a no-op when the first wins. Used by every close path (last-leave
 * grace, idle timeout, zombie sweep) to make duplicate fires harmless.
 */
export async function closeRoomIfOpen(pool: pg.Pool, roomId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE rooms SET state = 'closed', closed_at = now()
     WHERE id = $1 AND state != 'closed'`,
    [roomId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Active (non-closed) rooms for a jar. Used on delete to disconnect live sockets. */
export async function listActiveRoomsForJar(pool: pg.Pool, jarId: string): Promise<RoomRow[]> {
  const { rows } = await pool.query("SELECT * FROM rooms WHERE jar_id = $1 AND state != 'closed'", [
    jarId,
  ]);
  return rows.map(rowToRoom);
}
