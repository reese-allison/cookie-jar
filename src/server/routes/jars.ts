import { Router } from "express";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import { type AuthenticatedRequest, requireAuth } from "../middleware/requireAuth";

export const jarRouter = Router();

// Create a jar (requires auth — ownerId comes from session)
jarRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { name, appearance, config } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const jar = await jarQueries.createJar(pool, {
      ownerId: req.user?.id,
      name,
      appearance,
      config,
    });
    res.status(201).json(jar);
  } catch (_err) {
    res.status(500).json({ error: "Failed to create jar" });
  }
});

// Get a jar by ID (public)
jarRouter.get("/:id", async (req, res) => {
  try {
    const jar = await jarQueries.getJarById(pool, req.params.id);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    res.json(jar);
  } catch (_err) {
    res.status(500).json({ error: "Failed to get jar" });
  }
});

// List jars by owner (public)
jarRouter.get("/", async (req, res) => {
  try {
    const ownerId = req.query.ownerId as string;
    if (!ownerId) {
      res.status(400).json({ error: "ownerId query parameter is required" });
      return;
    }
    const jars = await jarQueries.listJarsByOwner(pool, ownerId);
    res.json(jars);
  } catch (_err) {
    res.status(500).json({ error: "Failed to list jars" });
  }
});

// Update a jar (requires auth + owner)
jarRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jar = await jarQueries.getJarById(pool, req.params.id);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (jar.ownerId !== req.user?.id) {
      res.status(403).json({ error: "Only the jar owner can update it" });
      return;
    }
    const { name, appearance, config } = req.body;
    const updated = await jarQueries.updateJar(pool, req.params.id, { name, appearance, config });
    res.json(updated);
  } catch (_err) {
    res.status(500).json({ error: "Failed to update jar" });
  }
});

// Delete a jar (requires auth + owner)
jarRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jar = await jarQueries.getJarById(pool, req.params.id);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (jar.ownerId !== req.user?.id) {
      res.status(403).json({ error: "Only the jar owner can delete it" });
      return;
    }
    await jarQueries.deleteJar(pool, req.params.id);
    res.status(204).send();
  } catch (_err) {
    res.status(500).json({ error: "Failed to delete jar" });
  }
});
