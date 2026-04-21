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

// Postgres auto-names the `code UNIQUE` constraint this way. Used so callers
// can distinguish a code collision (retryable here) from the partial
// one-active-room-per-jar index (retryable at the route level).
export const ROOM_CODE_UNIQUE_CONSTRAINT = "rooms_code_key";
export const ROOM_ACTIVE_PER_JAR_CONSTRAINT = "idx_rooms_active_per_jar";

// 32^6 ≈ 1B codes. At 10k active rooms collision rate is ~5e-5 per create; the
// retry budget handles bursty pathological cases without spinning forever.
const CODE_COLLISION_RETRIES = 5;

function constraintOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { code?: string; constraint?: string };
  if (e.code !== "23505") return undefined;
  return e.constraint;
}

export async function createRoom(pool: pg.Pool, input: CreateRoomInput): Promise<RoomRow> {
  for (let attempt = 0; attempt <= CODE_COLLISION_RETRIES; attempt++) {
    const code = generateRoomCode();
    try {
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
    } catch (err) {
      // Regenerate and retry only on a code collision. Any other 23505 (the
      // one-active-room-per-jar partial unique index, most notably) is the
      // caller's problem — they need to re-read the winning row, not pick a
      // new code.
      if (constraintOf(err) === ROOM_CODE_UNIQUE_CONSTRAINT && attempt < CODE_COLLISION_RETRIES) {
        continue;
      }
      throw err;
    }
  }
  // Unreachable — either we returned or the last iteration threw.
  throw new Error("createRoom exhausted code-collision retries");
}

export function isRoomConstraintViolation(err: unknown, constraint: string): boolean {
  return constraintOf(err) === constraint;
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
