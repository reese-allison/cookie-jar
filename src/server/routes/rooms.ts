import { Router } from "express";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as roomQueries from "../db/queries/rooms";
import { type AuthenticatedRequest, requireAuth } from "../middleware/requireAuth";

export const roomRouter = Router();

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
    const room = await roomQueries.createRoom(pool, {
      jarId,
      maxParticipants,
      maxViewers,
      idleTimeoutMinutes,
    });
    res.status(201).json(room);
  } catch (_err) {
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
  } catch (_err) {
    res.status(500).json({ error: "Failed to get room" });
  }
});
