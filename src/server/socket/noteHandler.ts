import { NOTE_STYLES } from "@shared/constants";
import type { ClientToServerEvents, Note, ServerToClientEvents } from "@shared/types";
import { isValidNoteText, isValidUrl } from "@shared/validation";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as noteQueries from "../db/queries/notes";
import * as pullHistoryQueries from "../db/queries/pullHistory";
import type { SocketContext } from "./context";
import { withErrorHandler } from "./errorHandler";
import type { TypedServer } from "./server";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// In-memory sealed notes buffer per room (cleared on reveal)
const sealedNotes = new Map<string, Note[]>();

export function clearSealedNotes(roomId: string): void {
  sealedNotes.delete(roomId);
}

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
  // biome-ignore lint/suspicious/noExplicitAny: socket handlers have varied signatures
  const safe = (handler: (...args: any[]) => unknown) => withErrorHandler(socket, handler);

  socket.on(
    "note:add",
    safe(async (noteInput: { text: string; url?: string; style?: string }) => {
      if (!ctx.roomId || !ctx.jarId) return;
      if (!requireContributor(ctx, socket)) return;
      if (!isValidNoteText(noteInput.text)) {
        socket.emit("room:error", "Note text must be 1-500 characters");
        return;
      }

      if (noteInput.url && !isValidUrl(noteInput.url)) {
        socket.emit("room:error", "Invalid URL");
        return;
      }
      const style = NOTE_STYLES.includes(noteInput.style as (typeof NOTE_STYLES)[number])
        ? (noteInput.style as Note["style"])
        : "sticky";

      const note = await noteQueries.createNote(pool, {
        jarId: ctx.jarId,
        text: noteInput.text,
        url: noteInput.url,
        style,
        authorId: ctx.userId ?? undefined,
      });

      const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
      io.to(ctx.roomId).emit("note:added", note, inJarCount);
    }),
  );

  socket.on(
    "note:pull",
    safe(async () => {
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
        const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
        handleSealedPull(io, ctx, note, pulledBy, inJarCount);
      } else if (isPrivate) {
        socket.emit("note:pulled", note, pulledBy);
        const [inJarCount, pullCounts] = await Promise.all([
          noteQueries.countNotesByState(pool, ctx.jarId, "in_jar"),
          noteQueries.getPullCounts(pool, ctx.jarId),
        ]);
        // Count-only update to peers — pulledNotes omitted so clients preserve their own state.
        socket.to(ctx.roomId).emit("note:state", { inJarCount, pullCounts });
      } else {
        io.to(ctx.roomId).emit("note:pulled", note, pulledBy);
      }
    }),
  );

  socket.on(
    "note:discard",
    safe(async (noteId: string) => {
      if (!ctx.roomId || !ctx.jarId) return;
      if (!requireContributor(ctx, socket)) return;

      const updated = await noteQueries.updateNoteStateIfInJar(
        pool,
        noteId,
        ctx.jarId,
        "discarded",
      );
      if (!updated) return;

      io.to(ctx.roomId).emit("note:discarded", noteId);
    }),
  );

  socket.on(
    "note:return",
    safe(async (noteId: string) => {
      if (!ctx.roomId || !ctx.jarId) return;
      if (!requireContributor(ctx, socket)) return;

      const updated = await noteQueries.updateNoteStateIfInJar(pool, noteId, ctx.jarId, "in_jar");
      if (!updated) return;

      const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
      io.to(ctx.roomId).emit("note:returned", noteId, inJarCount);
    }),
  );

  socket.on(
    "history:get",
    safe(async () => {
      if (!ctx.jarId) return;
      const entries = await pullHistoryQueries.getHistory(pool, ctx.jarId);
      const isPrivate = ctx.jarConfig?.pullVisibility === "private";
      const filtered =
        isPrivate && ctx.role !== "owner"
          ? entries.filter((e) => e.pulledBy === ctx.displayName)
          : entries;
      socket.emit(
        "history:list",
        filtered.map((e) => ({
          id: e.id,
          noteText: e.noteText,
          pulledBy: e.pulledBy,
          pulledAt: e.pulledAt,
        })),
      );
    }),
  );

  socket.on(
    "history:clear",
    safe(async () => {
      if (!ctx.jarId || !ctx.isAuthenticated) return;
      if (ctx.role !== "owner") {
        socket.emit("room:error", "Only the jar owner can clear history");
        return;
      }
      await pullHistoryQueries.clearHistory(pool, ctx.jarId);
      socket.emit("history:list", []);
    }),
  );
}

function handleSealedPull(
  io: TypedServer,
  ctx: SocketContext,
  note: Note,
  pulledBy: string,
  inJarCount: number,
): void {
  if (!ctx.roomId) return;
  const revealAt = ctx.jarConfig?.sealedRevealCount ?? 1;

  if (!sealedNotes.has(ctx.roomId)) {
    sealedNotes.set(ctx.roomId, []);
  }
  const buffer = sealedNotes.get(ctx.roomId) ?? [];
  buffer.push(note);

  io.to(ctx.roomId).emit("note:sealed", pulledBy, buffer.length, revealAt, inJarCount);

  if (buffer.length >= revealAt) {
    io.to(ctx.roomId).emit("note:reveal", buffer);
    sealedNotes.delete(ctx.roomId);
  }
}
