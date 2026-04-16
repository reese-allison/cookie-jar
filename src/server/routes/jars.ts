import { Router } from "express";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";

export const jarRouter = Router();

// Create a jar
jarRouter.post("/", async (req, res) => {
  try {
    const { ownerId, name, appearance, config } = req.body;
    if (!ownerId || !name) {
      res.status(400).json({ error: "ownerId and name are required" });
      return;
    }
    const jar = await jarQueries.createJar(pool, { ownerId, name, appearance, config });
    res.status(201).json(jar);
  } catch (_err) {
    res.status(500).json({ error: "Failed to create jar" });
  }
});

// Get a jar by ID
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

// List jars by owner
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

// Update a jar
jarRouter.patch("/:id", async (req, res) => {
  try {
    const { name, appearance, config } = req.body;
    const jar = await jarQueries.updateJar(pool, req.params.id, { name, appearance, config });
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    res.json(jar);
  } catch (_err) {
    res.status(500).json({ error: "Failed to update jar" });
  }
});

// Delete a jar
jarRouter.delete("/:id", async (req, res) => {
  try {
    const deleted = await jarQueries.deleteJar(pool, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    res.status(204).send();
  } catch (_err) {
    res.status(500).json({ error: "Failed to delete jar" });
  }
});
