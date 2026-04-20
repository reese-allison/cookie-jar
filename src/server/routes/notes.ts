import { MAX_BULK_IMPORT, MAX_NOTES_PER_JAR } from "@shared/constants";
import type { Jar, NoteState } from "@shared/types";
import { isValidNoteText, isValidUrl } from "@shared/validation";
import { Router } from "express";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as noteQueries from "../db/queries/notes";
import { logger } from "../logger";
import {
  type AuthenticatedRequest,
  attachUser,
  getUser,
  requireAuth,
} from "../middleware/requireAuth";

export const noteRouter = Router();

const VALID_STATES: NoteState[] = ["in_jar", "pulled", "discarded"];

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isNoteState(v: unknown): v is NoteState {
  return typeof v === "string" && (VALID_STATES as string[]).includes(v);
}

/**
 * Fetch a jar and enforce that `viewerId` is allowed to read it. Anyone can
 * read a public or template jar; otherwise only the owner. Returns the jar on
 * success or null with an HTTP status already written to `res`.
 */
async function loadReadableJar(
  jarId: string,
  viewerId: string | null,
  res: Parameters<Parameters<typeof noteRouter.get>[1]>[1],
): Promise<Jar | null> {
  const jar = await jarQueries.getJarById(pool, jarId);
  if (!jar) {
    res.status(404).json({ error: "Jar not found" });
    return null;
  }
  if (!jar.isPublic && !jar.isTemplate && jar.ownerId !== viewerId) {
    res.status(403).json({ error: "Not authorized to view this jar" });
    return null;
  }
  return jar;
}

// Create a note (requires auth + jar owner). Contributors add notes via the
// socket `note:add` event — this route is for the owner's seeding / scripting.
noteRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { jarId, text, url, style } = req.body;
    if (!jarId || typeof text !== "string" || !isValidNoteText(text)) {
      res.status(400).json({ error: "jarId and valid text (1-500 chars) are required" });
      return;
    }
    if (url !== undefined && url !== null && url !== "" && !isValidUrl(url)) {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }
    const jar = await jarQueries.getJarById(pool, jarId);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (jar.ownerId !== getUser(req).id) {
      res.status(403).json({ error: "Only the jar owner can add notes via REST" });
      return;
    }
    const existing = await noteQueries.countNotesByState(pool, jarId, "in_jar");
    if (existing >= MAX_NOTES_PER_JAR) {
      res.status(400).json({ error: `Jar is full (${MAX_NOTES_PER_JAR} notes max)` });
      return;
    }
    const note = await noteQueries.createNote(pool, {
      jarId,
      text: text.trim(),
      url: url || undefined,
      style: style ?? "sticky",
      authorId: getUser(req).id,
    });
    res.status(201).json(note);
  } catch (err) {
    logger.error({ err }, "POST /api/notes failed");
    res.status(500).json({ error: "Failed to create note" });
  }
});

// List notes by jar. Private jars require owner auth; public/template jars
// are readable by anyone.
noteRouter.get("/", attachUser, async (req: AuthenticatedRequest, res) => {
  try {
    const jarId = asString(req.query.jarId);
    if (!jarId) {
      res.status(400).json({ error: "jarId query parameter is required" });
      return;
    }
    const jar = await loadReadableJar(jarId, req.user?.id ?? null, res);
    if (!jar) return;
    const rawState = req.query.state;
    const state = isNoteState(rawState) ? rawState : undefined;
    const notes = await noteQueries.listNotesByJar(pool, jarId, state);
    res.json(notes);
  } catch (err) {
    logger.error({ err }, "GET /api/notes failed");
    res.status(500).json({ error: "Failed to list notes" });
  }
});

// Update a note's text (requires auth + jar owner)
noteRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const noteId = asString(req.params.id);
    const note = await noteQueries.getNoteById(pool, noteId);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const jar = await jarQueries.getJarById(pool, note.jarId);
    if (jar?.ownerId !== getUser(req).id) {
      res.status(403).json({ error: "Only the jar owner can edit notes" });
      return;
    }
    const { text, url } = req.body;
    if (text !== undefined && (typeof text !== "string" || !isValidNoteText(text))) {
      res.status(400).json({ error: "text must be 1-500 characters" });
      return;
    }
    if (url !== undefined && url !== null && url !== "" && !isValidUrl(url)) {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }
    const updated = await noteQueries.updateNote(pool, noteId, {
      text: typeof text === "string" ? text.trim() : undefined,
      url: url === "" ? undefined : url,
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /api/notes/:id failed");
    res.status(500).json({ error: "Failed to update note" });
  }
});

// Update a note's state (requires auth + jar owner)
noteRouter.patch("/:id/state", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { state } = req.body;
    if (!isNoteState(state)) {
      res.status(400).json({ error: "state must be one of: in_jar, pulled, discarded" });
      return;
    }
    const noteId = asString(req.params.id);
    const note = await noteQueries.getNoteById(pool, noteId);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const jar = await jarQueries.getJarById(pool, note.jarId);
    if (jar?.ownerId !== getUser(req).id) {
      res.status(403).json({ error: "Only the jar owner can change note state" });
      return;
    }
    const updated = await noteQueries.updateNoteState(pool, noteId, state);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /api/notes/:id/state failed");
    res.status(500).json({ error: "Failed to update note state" });
  }
});

// Delete a note (requires auth + jar owner)
noteRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const noteId = asString(req.params.id);
    const note = await noteQueries.getNoteById(pool, noteId);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const jar = await jarQueries.getJarById(pool, note.jarId);
    if (jar?.ownerId !== getUser(req).id) {
      res.status(403).json({ error: "Only the jar owner can delete notes" });
      return;
    }
    await noteQueries.deleteNote(pool, noteId);
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "DELETE /api/notes/:id failed");
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// Bulk import notes (requires auth + jar owner)
noteRouter.post("/bulk-import", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { jarId, texts } = req.body;
    if (!jarId || !Array.isArray(texts)) {
      res.status(400).json({ error: "jarId and texts array are required" });
      return;
    }
    if (texts.length > MAX_BULK_IMPORT) {
      res.status(400).json({ error: `Maximum ${MAX_BULK_IMPORT} notes per import` });
      return;
    }
    const jar = await jarQueries.getJarById(pool, jarId);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (jar.ownerId !== getUser(req).id) {
      res.status(403).json({ error: "Only the jar owner can import notes" });
      return;
    }
    const validTexts = texts.filter(
      (t): t is string => typeof t === "string" && isValidNoteText(t),
    );
    // Cap against total jar size so a loop of bulk-imports can't blow past the
    // per-jar cap and DoS the pod.
    const existing = await noteQueries.countNotesByState(pool, jarId, "in_jar");
    const roomLeft = MAX_NOTES_PER_JAR - existing;
    if (roomLeft <= 0) {
      res.status(400).json({
        error: `Jar is full (${MAX_NOTES_PER_JAR} notes max). Discard some first.`,
      });
      return;
    }
    const toImport = validTexts.slice(0, roomLeft);
    const count = await noteQueries.bulkCreateNotes(pool, jarId, toImport);
    res.status(201).json({ imported: count, skipped: validTexts.length - count });
  } catch (err) {
    logger.error({ err }, "POST /api/notes/bulk-import failed");
    res.status(500).json({ error: "Failed to import notes" });
  }
});

// Export notes. Same readability rule as GET /: private jars require the owner.
noteRouter.get("/export", attachUser, async (req: AuthenticatedRequest, res) => {
  try {
    const jarId = asString(req.query.jarId);
    const format = asString(req.query.format) || "json";
    if (!jarId) {
      res.status(400).json({ error: "jarId query parameter is required" });
      return;
    }
    const jar = await loadReadableJar(jarId, req.user?.id ?? null, res);
    if (!jar) return;
    const notes = await noteQueries.listNotesByJar(pool, jarId);

    if (format === "csv") {
      const escapeCsv = (val: string) => {
        let escaped = val.replace(/"/g, '""');
        // Mitigate formula injection
        if (/^[=+\-@]/.test(escaped)) escaped = `'${escaped}`;
        return `"${escaped}"`;
      };
      const header = "text,url,style,state";
      const rows = notes.map(
        (n) =>
          `${escapeCsv(n.text)},${escapeCsv(n.url ?? "")},${escapeCsv(n.style)},${escapeCsv(n.state)}`,
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=notes.csv");
      res.send([header, ...rows].join("\n"));
    } else {
      res.json(notes);
    }
  } catch (err) {
    logger.error({ err }, "GET /api/notes/export failed");
    res.status(500).json({ error: "Failed to export notes" });
  }
});
