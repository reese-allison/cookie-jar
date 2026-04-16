import { Router } from "express";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import { type AuthenticatedRequest, getUser, requireAuth } from "../middleware/requireAuth";

export const jarRouter = Router();

const MAX_JAR_NAME_LENGTH = 100;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Create a jar (requires auth — ownerId comes from session)
jarRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { name, appearance, config } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (name.length > MAX_JAR_NAME_LENGTH) {
      res.status(400).json({ error: `name must be ${MAX_JAR_NAME_LENGTH} characters or fewer` });
      return;
    }
    const jar = await jarQueries.createJar(pool, {
      ownerId: getUser(req).id,
      name: name.trim(),
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
    const jar = await jarQueries.getJarById(pool, asString(req.params.id));
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
    const ownerId = asString(req.query.ownerId);
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

// List template jars (public)
jarRouter.get("/templates/list", async (_req, res) => {
  try {
    const templates = await jarQueries.listTemplates(pool);
    res.json(templates);
  } catch (_err) {
    res.status(500).json({ error: "Failed to list templates" });
  }
});

// Clone/fork a jar (requires auth)
jarRouter.post("/:id/clone", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jarId = asString(req.params.id);
    const source = await jarQueries.getJarById(pool, jarId);
    if (!source) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (!source.isTemplate && !source.isPublic && source.ownerId !== getUser(req).id) {
      res.status(403).json({ error: "This jar cannot be cloned" });
      return;
    }
    const cloned = await jarQueries.cloneJar(pool, jarId, getUser(req).id);
    res.status(201).json(cloned);
  } catch (_err) {
    res.status(500).json({ error: "Failed to clone jar" });
  }
});

// Update a jar (requires auth + owner)
jarRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jarId = asString(req.params.id);
    const jar = await jarQueries.getJarById(pool, jarId);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (jar.ownerId !== getUser(req).id) {
      res.status(403).json({ error: "Only the jar owner can update it" });
      return;
    }
    const { name, appearance, config } = req.body;
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "name must be a non-empty string" });
        return;
      }
      if (name.length > MAX_JAR_NAME_LENGTH) {
        res.status(400).json({ error: `name must be ${MAX_JAR_NAME_LENGTH} characters or fewer` });
        return;
      }
    }
    const updated = await jarQueries.updateJar(pool, jarId, {
      name: typeof name === "string" ? name.trim() : undefined,
      appearance,
      config,
    });
    res.json(updated);
  } catch (_err) {
    res.status(500).json({ error: "Failed to update jar" });
  }
});

// Delete a jar (requires auth + owner)
jarRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jarId = asString(req.params.id);
    const jar = await jarQueries.getJarById(pool, jarId);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (jar.ownerId !== getUser(req).id) {
      res.status(403).json({ error: "Only the jar owner can delete it" });
      return;
    }
    await jarQueries.deleteJar(pool, jarId);
    res.status(204).send();
  } catch (_err) {
    res.status(500).json({ error: "Failed to delete jar" });
  }
});
