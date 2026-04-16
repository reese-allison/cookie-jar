import type { ClientToServerEvents, ServerToClientEvents } from "@shared/types";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as noteQueries from "../db/queries/notes";
import type { SocketContext } from "./context";
import type { TypedServer } from "./server";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

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

    const isPrivate = ctx.jarConfig?.pullVisibility === "private";

    if (isPrivate) {
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
}
