import type { NoteState } from "@shared/types";
import { Router } from "express";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as noteQueries from "../db/queries/notes";
import { type AuthenticatedRequest, requireAuth } from "../middleware/requireAuth";

export const noteRouter = Router();

// Create a note (requires auth)
noteRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { jarId, text, url, style } = req.body;
    if (!jarId || !text) {
      res.status(400).json({ error: "jarId and text are required" });
      return;
    }
    const note = await noteQueries.createNote(pool, {
      jarId,
      text,
      url,
      style: style ?? "sticky",
      authorId: req.user?.id,
    });
    res.status(201).json(note);
  } catch (_err) {
    res.status(500).json({ error: "Failed to create note" });
  }
});

// List notes by jar
noteRouter.get("/", async (req, res) => {
  try {
    const jarId = req.query.jarId as string;
    const state = req.query.state as NoteState | undefined;
    if (!jarId) {
      res.status(400).json({ error: "jarId query parameter is required" });
      return;
    }
    const notes = await noteQueries.listNotesByJar(pool, jarId, state);
    res.json(notes);
  } catch (_err) {
    res.status(500).json({ error: "Failed to list notes" });
  }
});

// Pull a random note from a jar (requires auth)
noteRouter.post("/pull", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { jarId } = req.body;
    if (!jarId) {
      res.status(400).json({ error: "jarId is required" });
      return;
    }
    const note = await noteQueries.pullRandomNote(pool, jarId);
    if (!note) {
      res.status(404).json({ error: "No notes available to pull" });
      return;
    }
    res.json(note);
  } catch (_err) {
    res.status(500).json({ error: "Failed to pull note" });
  }
});

// Update a note's text (requires auth + jar owner)
noteRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const note = await noteQueries.getNoteById(pool, req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const jar = await jarQueries.getJarById(pool, note.jarId);
    if (jar?.ownerId !== req.user?.id) {
      res.status(403).json({ error: "Only the jar owner can edit notes" });
      return;
    }
    const { text, url } = req.body;
    const updated = await noteQueries.updateNote(pool, req.params.id, { text, url });
    res.json(updated);
  } catch (_err) {
    res.status(500).json({ error: "Failed to update note" });
  }
});

// Update a note's state (requires auth + jar owner)
noteRouter.patch("/:id/state", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { state } = req.body;
    const VALID_STATES = ["in_jar", "pulled", "discarded"];
    if (!state || !VALID_STATES.includes(state)) {
      res.status(400).json({ error: "state must be one of: in_jar, pulled, discarded" });
      return;
    }
    const note = await noteQueries.getNoteById(pool, req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const jar = await jarQueries.getJarById(pool, note.jarId);
    if (jar?.ownerId !== req.user?.id) {
      res.status(403).json({ error: "Only the jar owner can change note state" });
      return;
    }
    const updated = await noteQueries.updateNoteState(pool, req.params.id, state);
    res.json(updated);
  } catch (_err) {
    res.status(500).json({ error: "Failed to update note state" });
  }
});

// Delete a note (requires auth + jar owner)
noteRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const note = await noteQueries.getNoteById(pool, req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const jar = await jarQueries.getJarById(pool, note.jarId);
    if (jar?.ownerId !== req.user?.id) {
      res.status(403).json({ error: "Only the jar owner can delete notes" });
      return;
    }
    await noteQueries.deleteNote(pool, req.params.id);
    res.status(204).send();
  } catch (_err) {
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
    if (texts.length > 500) {
      res.status(400).json({ error: "Maximum 500 notes per import" });
      return;
    }
    const jar = await jarQueries.getJarById(pool, jarId);
    if (!jar) {
      res.status(404).json({ error: "Jar not found" });
      return;
    }
    if (jar.ownerId !== req.user?.id) {
      res.status(403).json({ error: "Only the jar owner can import notes" });
      return;
    }
    const count = await noteQueries.bulkCreateNotes(pool, jarId, texts);
    res.status(201).json({ imported: count });
  } catch (_err) {
    res.status(500).json({ error: "Failed to import notes" });
  }
});

// Export notes as JSON (public)
noteRouter.get("/export", async (req, res) => {
  try {
    const jarId = req.query.jarId as string;
    const format = (req.query.format as string) ?? "json";
    if (!jarId) {
      res.status(400).json({ error: "jarId query parameter is required" });
      return;
    }
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
  } catch (_err) {
    res.status(500).json({ error: "Failed to export notes" });
  }
});
