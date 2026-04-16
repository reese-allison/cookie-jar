import type { ClientToServerEvents, Note, ServerToClientEvents } from "@shared/types";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as noteQueries from "../db/queries/notes";
import * as pullHistoryQueries from "../db/queries/pullHistory";
import type { SocketContext } from "./context";
import type { TypedServer } from "./server";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// In-memory sealed notes buffer per room (cleared on reveal)
const sealedNotes = new Map<string, Note[]>();

function requireContributor(ctx: SocketContext, socket: TypedSocket): boolean {
  if (!ctx.isAuthenticated || ctx.role === "viewer") {
    socket.emit("room:error", "Sign in to participate");
    return false;
  }
  return true;
}

export function registerNoteHandlers(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
): void {
  socket.on("note:add", async (noteInput) => {
    if (!ctx.roomId || !ctx.jarId) return;
    if (!requireContributor(ctx, socket)) return;

    const note = await noteQueries.createNote(pool, {
      jarId: ctx.jarId,
      text: noteInput.text,
      url: noteInput.url,
      style: noteInput.style ?? "sticky",
      authorId: ctx.userId ?? undefined,
    });

    const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
    io.to(ctx.roomId).emit("note:added", note, inJarCount);
  });

  socket.on("note:pull", async () => {
    if (!ctx.roomId || !ctx.jarId) return;
    if (!requireContributor(ctx, socket)) return;

    const pulledBy = ctx.displayName ?? ctx.memberId ?? socket.id;
    const note = await noteQueries.pullRandomNote(pool, ctx.jarId, pulledBy);
    if (!note) {
      socket.emit("pull:rejected", "The jar is empty");
      return;
    }

    await pullHistoryQueries.recordPull(pool, {
      jarId: ctx.jarId,
      noteId: note.id,
      pulledBy,
      roomId: ctx.roomId ?? undefined,
    });

    const isSealed = ctx.jarConfig?.noteVisibility === "sealed";
    const isPrivate = ctx.jarConfig?.pullVisibility === "private";

    if (isSealed) {
      handleSealedPull(io, ctx, note, pulledBy);
    } else if (isPrivate) {
      socket.emit("note:pulled", note, pulledBy);
      const pullCounts = await noteQueries.getPullCounts(pool, ctx.jarId);
      socket.to(ctx.roomId).emit("note:state", {
        inJarCount: await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar"),
        pulledNotes: [],
        pullCounts,
      });
    } else {
      io.to(ctx.roomId).emit("note:pulled", note, pulledBy);
    }
  });

  socket.on("note:discard", async (noteId) => {
    if (!ctx.roomId) return;
    if (!requireContributor(ctx, socket)) return;

    const updated = await noteQueries.updateNoteState(pool, noteId, "discarded");
    if (!updated) return;

    io.to(ctx.roomId).emit("note:discarded", noteId);
  });

  socket.on("note:return", async (noteId) => {
    if (!ctx.roomId || !ctx.jarId) return;
    if (!requireContributor(ctx, socket)) return;

    const updated = await noteQueries.updateNoteState(pool, noteId, "in_jar");
    if (!updated) return;

    const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
    io.to(ctx.roomId).emit("note:returned", noteId, inJarCount);
  });

  socket.on("history:get", async () => {
    if (!ctx.jarId) return;
    const entries = await pullHistoryQueries.getHistory(pool, ctx.jarId);
    socket.emit(
      "history:list",
      entries.map((e) => ({
        id: e.id,
        noteText: e.noteText,
        pulledBy: e.pulledBy,
        pulledAt: e.pulledAt,
      })),
    );
  });

  socket.on("history:clear", async () => {
    if (!ctx.jarId || !ctx.isAuthenticated) return;
    if (ctx.role !== "owner") {
      socket.emit("room:error", "Only the jar owner can clear history");
      return;
    }
    await pullHistoryQueries.clearHistory(pool, ctx.jarId);
    socket.emit("history:list", []);
  });
}

function handleSealedPull(io: TypedServer, ctx: SocketContext, note: Note, pulledBy: string): void {
  if (!ctx.roomId) return;
  const revealAt = ctx.jarConfig?.sealedRevealCount ?? 1;

  if (!sealedNotes.has(ctx.roomId)) {
    sealedNotes.set(ctx.roomId, []);
  }
  const buffer = sealedNotes.get(ctx.roomId) ?? [];
  buffer.push(note);

  // Broadcast that a sealed pull happened (no content revealed)
  io.to(ctx.roomId).emit("note:sealed", pulledBy, buffer.length, revealAt);

  // Check if it's time to reveal
  if (buffer.length >= revealAt) {
    io.to(ctx.roomId).emit("note:reveal", buffer);
    sealedNotes.delete(ctx.roomId);
  }
}
