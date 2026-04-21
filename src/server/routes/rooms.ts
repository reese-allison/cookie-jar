import { Router } from "express";
import { canAccessJar } from "../access";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as roomQueries from "../db/queries/rooms";
import { logger } from "../logger";
import { type AuthenticatedRequest, getUser, requireAuth } from "../middleware/requireAuth";

export const roomRouter = Router();

// Keep these modest — they bound the server's worst-case fanout per room and
// guard the idle-timeout timer against absurd values.
const MAX_PARTICIPANTS_CAP = 200;
const MAX_VIEWERS_CAP = 500;
const MAX_IDLE_TIMEOUT_MINUTES = 24 * 60;

type BoundedField = "maxParticipants" | "maxViewers" | "idleTimeoutMinutes";

function validateBounded(
  field: BoundedField,
  v: unknown,
  min: number,
  max: number,
): { value: number | undefined; error: string | null } {
  if (v === undefined || v === null) return { value: undefined, error: null };
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    return { value: undefined, error: `${field} must be an integer` };
  }
  if (v < min || v > max) {
    return { value: undefined, error: `${field} must be between ${min} and ${max}` };
  }
  return { value: v, error: null };
}

// Create a room for a jar. Open to the owner or anyone on the jar's
// allowlist. If an active room already exists for the jar, return that one —
// we cap jars at one active room to keep the "Copy room code" UX unambiguous
// and avoid a split-brain where two groups play separate sessions.
roomRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { jarId, maxParticipants, maxViewers, idleTimeoutMinutes } = req.body;
    if (!jarId) {
      res.status(400).json({ error: "jarId is required" });
      return;
    }
    const checks = [
      validateBounded("maxParticipants", maxParticipants, 1, MAX_PARTICIPANTS_CAP),
      validateBounded("maxViewers", maxViewers, 0, MAX_VIEWERS_CAP),
      validateBounded("idleTimeoutMinutes", idleTimeoutMinutes, 1, MAX_IDLE_TIMEOUT_MINUTES),
    ] as const;
    const firstError = checks.find((c) => c.error)?.error;
    if (firstError) {
      res.status(400).json({ error: firstError });
      return;
    }
    const jar = await jarQueries.getJarById(pool, jarId);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    const viewer = { userId: getUser(req).id, email: getUser(req).email };
    if (!canAccessJar(jar, viewer)) {
      res.status(403).json({ error: "Not authorized to create a room for this jar" });
      return;
    }
    // One-active-room-per-jar. Fast-path: return any existing open room. If
    // we don't see one here but a concurrent request just inserted the
    // winning row, createRoom will trip the partial unique index and we fall
    // through to re-querying and returning whoever won the race.
    const existing = await roomQueries.listActiveRoomsForJar(pool, jarId);
    if (existing.length > 0) {
      res.status(200).json(existing[0]);
      return;
    }
    try {
      const room = await roomQueries.createRoom(pool, {
        jarId,
        maxParticipants: checks[0].value,
        maxViewers: checks[1].value,
        idleTimeoutMinutes: checks[2].value,
      });
      res.status(201).json(room);
    } catch (err) {
      // Partial unique index on rooms(jar_id) WHERE state != 'closed' —
      // Postgres raises SQLSTATE 23505 when two creates race. Re-read and
      // return the winner so the client always lands in the shared room.
      if (isUniqueViolation(err)) {
        const racedWinner = await roomQueries.listActiveRoomsForJar(pool, jarId);
        if (racedWinner.length > 0) {
          res.status(200).json(racedWinner[0]);
          return;
        }
      }
      throw err;
    }
  } catch (err) {
    logger.error({ err }, "POST /api/rooms failed");
    res.status(500).json({ error: "Failed to create room" });
  }
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

// Look up a room by code (public)
roomRouter.get("/:code", async (req, res) => {
  try {
    const room = await roomQueries.getRoomByCode(pool, req.params.code.toUpperCase());
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    res.json(room);
  } catch (err) {
    logger.error({ err }, "GET /api/rooms/:code failed");
    res.status(500).json({ error: "Failed to get room" });
  }
});
