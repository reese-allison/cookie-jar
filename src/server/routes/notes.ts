import { MAX_BULK_IMPORT, MAX_EXPORT_NOTES, MAX_NOTES_PER_JAR } from "@shared/constants";
import type { Jar, NoteState } from "@shared/types";
import { isValidNoteText, isValidUrl, parseNoteInput } from "@shared/validation";
import { type Response, Router } from "express";
import { canAccessJar } from "../access";
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
import {
  broadcastJarNoteState,
  broadcastNoteUpdated,
  removeFromSealedBuffers,
  updateSealedBuffers,
} from "../socket/broadcaster";
import { fireAndForget } from "../socket/fireAndForget";

export const noteRouter = Router();

const VALID_STATES: NoteState[] = ["in_jar", "pulled", "discarded"];

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isNoteState(v: unknown): v is NoteState {
  return typeof v === "string" && (VALID_STATES as string[]).includes(v);
}

/**
 * Lock check for REST mutations that "add or remove" from the visible pool.
 * Text edits and non-destructive state flips don't need this. Writes the
 * response and returns false when locked.
 */
function assertUnlocked(jar: Jar, res: Response): boolean {
  if (jar.config?.locked) {
    res.status(409).json({ error: "Jar is locked — unlock in settings first" });
    return false;
  }
  return true;
}

/**
 * Fetch a jar and enforce access via canAccessJar (owner, public, template,
 * or allowlist). Returns the jar on success or null with an HTTP status
 * already written to `res`.
 */
async function loadReadableJar(
  jarId: string,
  viewer: { userId: string | null; email: string | null },
  res: Response,
): Promise<Jar | null> {
  const jar = await jarQueries.getJarById(pool, jarId);
  if (!jar) {
    res.status(404).json({ error: "Jar not found" });
    return null;
  }
  if (!canAccessJar(jar, viewer)) {
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
    if (!jarId) {
      res.status(400).json({ error: "jarId is required" });
      return;
    }
    const parsed = parseNoteInput({ text, url, style });
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
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
    if (!assertUnlocked(jar, res)) return;
    const note = await noteQueries.createNoteIfUnderCap(
      pool,
      {
        jarId,
        text: parsed.note.text,
        url: parsed.note.url,
        style: parsed.note.style,
        authorId: getUser(req).id,
      },
      MAX_NOTES_PER_JAR,
    );
    if (!note) {
      res.status(400).json({ error: `Jar is full (${MAX_NOTES_PER_JAR} notes max)` });
      return;
    }
    res.status(201).json(note);
    // Push the new inJarCount to every live room so peers see the add without
    // waiting for a jar:refresh.
    fireAndForget(broadcastJarNoteState(jarId), "broadcastJarNoteState(create)");
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
    const jar = await loadReadableJar(
      jarId,
      { userId: req.user?.id ?? null, email: req.user?.email ?? null },
      res,
    );
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
    // Push the edit to every live room for this jar so peers don't keep
    // rendering the old text until a jar:refresh. Fire-and-forget — a
    // broadcast failure shouldn't fail the PATCH.
    if (updated) {
      fireAndForget(broadcastNoteUpdated(updated), "broadcastNoteUpdated");
      // If the note is in any active room's sealed buffer, replace the
      // buffered snapshot so the eventual reveal shows the new text.
      if (updated.state === "pulled") {
        fireAndForget(updateSealedBuffers(updated), "updateSealedBuffers(edit)");
      }
    }
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
    // Lock only blocks transitions that effectively add or discard (lock
    // says "no additions, no discards"). Pulled↔in_jar swaps are curation.
    if (state === "discarded" && !assertUnlocked(jar, res)) return;
    const updated = await noteQueries.updateNoteState(pool, noteId, state);
    res.json(updated);
    // Peers need to see state flips (pulled → discarded etc.) live.
    // broadcastNoteUpdated handles add/remove-from-pulled-list on the client.
    if (updated) {
      fireAndForget(broadcastNoteUpdated(updated), "broadcastNoteUpdated(state)");
      // If the note left "pulled" state, scrub it from sealed buffers — even
      // a state flip to in_jar/discarded would otherwise re-surface on the
      // next reveal with the old "pulled" snapshot.
      if (updated.state !== "pulled") {
        fireAndForget(
          removeFromSealedBuffers(updated.jarId, updated.id),
          "removeFromSealedBuffers(state)",
        );
      }
    }
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
    if (!assertUnlocked(jar, res)) return;
    await noteQueries.deleteNote(pool, noteId);
    res.status(204).send();
    // If the note was on the table, emit note:updated with a non-pulled state
    // so clients drop it from pulledNotes (store.noteUpdated removes on
    // non-pulled state). Also push the fresh count so the jar label updates.
    if (note.state === "pulled") {
      const ghost = { ...note, state: "discarded" as const };
      fireAndForget(broadcastNoteUpdated(ghost), "broadcastNoteUpdated(delete)");
    }
    // Scrub the deleted note from every active room's sealed buffer — would
    // otherwise materialize as a zombie on the next reveal since the buffer
    // holds a JSON snapshot independent of the notes row.
    fireAndForget(removeFromSealedBuffers(note.jarId, noteId), "removeFromSealedBuffers(delete)");
    fireAndForget(broadcastJarNoteState(note.jarId), "broadcastJarNoteState(delete)");
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
    if (!assertUnlocked(jar, res)) return;
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
    // Push the new inJarCount to every live room for this jar so peers see
    // the import without waiting for the owner to jar:refresh.
    if (count > 0) fireAndForget(broadcastJarNoteState(jarId), "broadcastJarNoteState(bulk)");
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
    const jar = await loadReadableJar(
      jarId,
      { userId: req.user?.id ?? null, email: req.user?.email ?? null },
      res,
    );
    if (!jar) return;
    // Cap the export — otherwise a long-lived public/template jar's cumulative
    // row count (discards + history) blows the Express response buffer. The
    // user sees the first MAX_EXPORT_NOTES chronologically; beyond that, they
    // need a future paginated endpoint (out of scope).
    const notes = await noteQueries.listNotesByJar(pool, jarId, undefined, MAX_EXPORT_NOTES);

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
