import { Router } from "express";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as roomQueries from "../db/queries/rooms";
import { logger } from "../logger";
import { type AuthenticatedRequest, requireAuth } from "../middleware/requireAuth";

export const roomRouter = Router();

// Keep these modest — they bound the server's worst-case fanout per room and
// guard the idle-timeout timer against absurd values.
const MAX_PARTICIPANTS_CAP = 200;
const MAX_VIEWERS_CAP = 500;
const MAX_IDLE_TIMEOUT_MINUTES = 24 * 60;

function coerceInt(v: unknown, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) return undefined;
  if (v < min || v > max) return undefined;
  return v;
}

// Create a room for a jar (requires auth + jar owner)
roomRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { jarId, maxParticipants, maxViewers, idleTimeoutMinutes } = req.body;
    if (!jarId) {
      res.status(400).json({ error: "jarId is required" });
      return;
    }
    const jar = await jarQueries.getJarById(pool, jarId);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (jar.ownerId !== req.user?.id) {
      res.status(403).json({ error: "Only the jar owner can create rooms" });
      return;
    }
    // Silently drop out-of-range values — the defaults in createRoom kick in.
    // Rejecting would force clients to know the exact bounds; clamping keeps
    // the API tolerant while still preventing abuse.
    const room = await roomQueries.createRoom(pool, {
      jarId,
      maxParticipants: coerceInt(maxParticipants, 1, MAX_PARTICIPANTS_CAP),
      maxViewers: coerceInt(maxViewers, 0, MAX_VIEWERS_CAP),
      idleTimeoutMinutes: coerceInt(idleTimeoutMinutes, 1, MAX_IDLE_TIMEOUT_MINUTES),
    });
    res.status(201).json(room);
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
