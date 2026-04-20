import type { JarAppearance, JarConfig } from "@shared/types";
import { sanitizeJarAppearance, sanitizeJarConfig } from "@shared/validation";
import { type Response, Router } from "express";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import { logger } from "../logger";
import {
  type AuthenticatedRequest,
  attachUser,
  getUser,
  requireAuth,
} from "../middleware/requireAuth";

export const jarRouter = Router();

const MAX_JAR_NAME_LENGTH = 100;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Run user input through the appearance/config sanitizers. Writes a 400 and
 * returns null on rejection so the caller can early-return.
 */
function parseJarShape(
  body: { appearance?: unknown; config?: unknown },
  res: Response,
): { appearance?: Partial<JarAppearance>; config?: Partial<JarConfig> } | null {
  let appearance: Partial<JarAppearance> | undefined;
  let config: Partial<JarConfig> | undefined;
  if (body.appearance !== undefined) {
    const cleaned = sanitizeJarAppearance(body.appearance);
    if (!cleaned) {
      res.status(400).json({ error: "Invalid appearance payload" });
      return null;
    }
    appearance = cleaned as Partial<JarAppearance>;
  }
  if (body.config !== undefined) {
    const cleaned = sanitizeJarConfig(body.config);
    if (!cleaned) {
      res.status(400).json({ error: "Invalid config payload" });
      return null;
    }
    config = cleaned as Partial<JarConfig>;
  }
  return { appearance, config };
}

// Create a jar (requires auth — ownerId comes from session)
jarRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (name.length > MAX_JAR_NAME_LENGTH) {
      res.status(400).json({ error: `name must be ${MAX_JAR_NAME_LENGTH} characters or fewer` });
      return;
    }
    const shape = parseJarShape(req.body, res);
    if (!shape) return;
    const jar = await jarQueries.createJar(pool, {
      ownerId: getUser(req).id,
      name: name.trim(),
      appearance: shape.appearance,
      config: shape.config,
    });
    res.status(201).json(jar);
  } catch (err) {
    logger.error({ err }, "POST /api/jars failed");
    res.status(500).json({ error: "Failed to create jar" });
  }
});

// List the current user's jars, each with any active (non-closed) rooms.
// Registered before /:id so "mine" isn't matched as an id.
jarRouter.get("/mine", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jars = await jarQueries.listOwnedJarsWithRooms(pool, getUser(req).id);
    res.json(jars);
  } catch (err) {
    logger.error({ err }, "GET /api/jars/mine failed");
    res.status(500).json({ error: "Failed to list your jars" });
  }
});

// Get a jar by ID. Private jars only return to their owner — config and
// appearance are considered sensitive (custom URLs, sealed settings).
jarRouter.get("/:id", attachUser, async (req: AuthenticatedRequest, res) => {
  try {
    const jar = await jarQueries.getJarById(pool, asString(req.params.id));
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (!jar.isPublic && !jar.isTemplate && jar.ownerId !== (req.user?.id ?? null)) {
      res.status(403).json({ error: "Not authorized to view this jar" });
      return;
    }
    res.json(jar);
  } catch (err) {
    logger.error({ err }, "GET /api/jars/:id failed");
    res.status(500).json({ error: "Failed to get jar" });
  }
});

// List jars by owner. Only public jars are exposed to non-owners; the owner
// themselves gets everything via GET /mine.
jarRouter.get("/", attachUser, async (req: AuthenticatedRequest, res) => {
  try {
    const ownerId = asString(req.query.ownerId);
    if (!ownerId) {
      res.status(400).json({ error: "ownerId query parameter is required" });
      return;
    }
    const includePrivate = req.user?.id === ownerId;
    const jars = await jarQueries.listJarsByOwner(pool, ownerId, { includePrivate });
    res.json(jars);
  } catch (err) {
    logger.error({ err }, "GET /api/jars failed");
    res.status(500).json({ error: "Failed to list jars" });
  }
});

// List template jars (public)
jarRouter.get("/templates/list", async (_req, res) => {
  try {
    const templates = await jarQueries.listTemplates(pool);
    res.json(templates);
  } catch (err) {
    logger.error({ err }, "GET /api/jars/templates/list failed");
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
  } catch (err) {
    logger.error({ err }, "POST /api/jars/:id/clone failed");
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
    const { name } = req.body;
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
    const shape = parseJarShape(req.body, res);
    if (!shape) return;
    // Pre-merge soundPack at the app layer — the DB-level `||` does a shallow
    // merge, so a PATCH with `{soundPack: {notePull: "x"}}` would otherwise
    // wipe the jar's other sound URLs. Top-level appearance fields still
    // merge shallowly via `||` in updateJar.
    const mergedAppearance =
      shape.appearance?.soundPack !== undefined
        ? {
            ...shape.appearance,
            soundPack: { ...(jar.appearance?.soundPack ?? {}), ...shape.appearance.soundPack },
          }
        : shape.appearance;
    const updated = await jarQueries.updateJar(pool, jarId, {
      name: typeof name === "string" ? name.trim() : undefined,
      appearance: mergedAppearance,
      config: shape.config,
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /api/jars/:id failed");
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
  } catch (err) {
    logger.error({ err }, "DELETE /api/jars/:id failed");
    res.status(500).json({ error: "Failed to delete jar" });
  }
});
