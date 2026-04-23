import { Router } from "express";
import { canJoinJar } from "../access";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as roomQueries from "../db/queries/rooms";
import { isRoomConstraintViolation, ROOM_ACTIVE_PER_JAR_CONSTRAINT } from "../db/queries/rooms";
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

// Create a room for a jar. Open to anyone who would be allowed to join a room
// for this jar (`canJoinJar`): the owner, public/template jars, anyone on the
// allowlist, and — for private jars without an allowlist — anyone with the
// jarId (the "starred a jar via the code" case). If an active room already
// exists for the jar, return that one — we cap jars at one active room to
// keep the "Copy room link" UX unambiguous and avoid a split-brain where two
// groups play separate sessions.
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
    const u = getUser(req);
    const viewer = { userId: u.id, email: u.email, emailVerified: u.emailVerified };
    if (!canJoinJar(jar, viewer)) {
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
      // Only the partial unique index on rooms(jar_id) WHERE state != 'closed'
      // means "another pod/request just created the active room for this
      // jar". Re-read and return the winner so the client always lands in the
      // shared room. Code-collision retries happen inside createRoom — if a
      // different constraint fires here, let it bubble to the outer 500.
      if (isRoomConstraintViolation(err, ROOM_ACTIVE_PER_JAR_CONSTRAINT)) {
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
