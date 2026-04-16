import type { NoteState } from "@shared/types";
import { Router } from "express";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as noteQueries from "../db/queries/notes";
import { type AuthenticatedRequest, requireAuth } from "../middleware/requireAuth";

export const noteRouter = Router();

// Create a note
noteRouter.post("/", async (req, res) => {
  try {
    const { jarId, text, url, style, authorId } = req.body;
    if (!jarId || !text || !authorId) {
      res.status(400).json({ error: "jarId, text, and authorId are required" });
      return;
    }
    const note = await noteQueries.createNote(pool, {
      jarId,
      text,
      url,
      style: style ?? "sticky",
      authorId,
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

// Pull a random note from a jar
noteRouter.post("/pull", async (req, res) => {
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

// Update a note's text
noteRouter.patch("/:id", async (req, res) => {
  try {
    const { text, url } = req.body;
    const note = await noteQueries.updateNote(pool, req.params.id, { text, url });
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(note);
  } catch (_err) {
    res.status(500).json({ error: "Failed to update note" });
  }
});

// Update a note's state (return to jar, discard, etc.)
noteRouter.patch("/:id/state", async (req, res) => {
  try {
    const { state } = req.body;
    if (!state) {
      res.status(400).json({ error: "state is required" });
      return;
    }
    const note = await noteQueries.updateNoteState(pool, req.params.id, state);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(note);
  } catch (_err) {
    res.status(500).json({ error: "Failed to update note state" });
  }
});

// Delete a note
noteRouter.delete("/:id", async (req, res) => {
  try {
    const deleted = await noteQueries.deleteNote(pool, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
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
      const header = "text,url,style,state";
      const rows = notes.map(
        (n) => `"${n.text.replace(/"/g, '""')}","${n.url ?? ""}","${n.style}","${n.state}"`,
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
