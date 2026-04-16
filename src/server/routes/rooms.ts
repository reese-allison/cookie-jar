import { Router } from "express";
import pool from "../db/pool";
import * as roomQueries from "../db/queries/rooms";

export const roomRouter = Router();

// Create a room for a jar
roomRouter.post("/", async (req, res) => {
  try {
    const { jarId, maxParticipants, maxViewers, idleTimeoutMinutes } = req.body;
    if (!jarId) {
      res.status(400).json({ error: "jarId is required" });
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

// Look up a room by code
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
