import type { JarAppearance, JarConfig } from "@shared/types";
import { sanitizeJarAppearance, sanitizeJarConfig } from "@shared/validation";
import { type Response, Router } from "express";
import { canAccessJar, canJoinJar } from "../access";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as starQueries from "../db/queries/starredJars";
import { logger } from "../logger";
import {
  type AuthenticatedRequest,
  attachUser,
  getUser,
  requireAuth,
} from "../middleware/requireAuth";
import { disconnectJarRooms } from "../socket/broadcaster";

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

// List the current user's jars — both their owned ones (with active rooms)
// and anything they've starred (including tombstones they've since lost
// access to). Registered before /:id so "mine" isn't matched as an id.
jarRouter.get("/mine", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const viewer = { userId: getUser(req).id, email: getUser(req).email };
    const [owned, starred] = await Promise.all([
      jarQueries.listOwnedJarsWithRooms(pool, viewer.userId),
      starQueries.listStarredJarsWithRooms(pool, viewer.userId),
    ]);
    // Starred list is shaped the same but carries a hasAccess flag so the
    // client can render "no access" as a tombstone without making a second
    // round-trip per jar to check the allowlist. Use canJoinJar — the same
    // rule the room:join socket and POST /api/rooms apply — so a code-holder
    // on a no-allowlist jar isn't mislabeled as "no access".
    const starredWithAccess = starred.map((jar) => ({
      ...jar,
      hasAccess: canJoinJar(jar, viewer),
    }));
    res.json({ ownedJars: owned, starredJars: starredWithAccess });
  } catch (err) {
    logger.error({ err }, "GET /api/jars/mine failed");
    res.status(500).json({ error: "Failed to list your jars" });
  }
});

// Star a jar (add it to "My Jars" for a non-owner). Requires access — you
// can't star a jar you don't have permission to see. Owners don't need to
// star their own jars; they're returned from the owned list unconditionally.
jarRouter.put("/:id/star", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jarId = asString(req.params.id);
    const viewer = { userId: getUser(req).id, email: getUser(req).email };
    const jar = await jarQueries.getJarById(pool, jarId);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (jar.ownerId === viewer.userId) {
      // Starring your own jar is a no-op; fail loud so clients don't gate UI
      // on a mixed "owned + starred" state.
      res.status(400).json({ error: "Owners don't need to star their own jars" });
      return;
    }
    // Mirror the join rule: if you can legitimately join this jar's rooms
    // (allowlist satisfied OR the jar has no allowlist so code-holders get
    // in) you should be able to bookmark it. Stricter canAccessJar would
    // block users who joined under the legacy "has-the-code" path.
    if (!canJoinJar(jar, viewer)) {
      res.status(403).json({ error: "Not authorized to star this jar" });
      return;
    }
    await starQueries.starJar(pool, viewer.userId, jarId);
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "PUT /api/jars/:id/star failed");
    res.status(500).json({ error: "Failed to star jar" });
  }
});

// Remove a star. Always allowed — your own bookmark, your choice.
jarRouter.delete("/:id/star", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const jarId = asString(req.params.id);
    await starQueries.unstarJar(pool, getUser(req).id, jarId);
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "DELETE /api/jars/:id/star failed");
    res.status(500).json({ error: "Failed to unstar jar" });
  }
});

// Get a jar by ID. Access rules: owner, public, template, or on the
// allowlist. Everything else is 403 — config and appearance carry custom
// URLs and sealed settings we treat as sensitive.
jarRouter.get("/:id", attachUser, async (req: AuthenticatedRequest, res) => {
  try {
    const jar = await jarQueries.getJarById(pool, asString(req.params.id));
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (!canAccessJar(jar, { userId: req.user?.id ?? null, email: req.user?.email ?? null })) {
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
    // Kick live sockets *before* the cascade-delete, otherwise the next DB
    // event from any of them 500s on a missing room/jar.
    await disconnectJarRooms(jarId, "This jar was deleted");
    await jarQueries.deleteJar(pool, jarId);
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "DELETE /api/jars/:id failed");
    res.status(500).json({ error: "Failed to delete jar" });
  }
});
