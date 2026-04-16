import type { ClientToServerEvents, ServerToClientEvents } from "@shared/types";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as noteQueries from "../db/queries/notes";
import type { SocketContext } from "./context";
import type { TypedServer } from "./server";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerNoteHandlers(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
): void {
  socket.on("note:add", async (noteInput) => {
    if (!ctx.roomId || !ctx.jarId) return;

    const note = await noteQueries.createNote(pool, {
      jarId: ctx.jarId,
      text: noteInput.text,
      url: noteInput.url,
      style: noteInput.style ?? "sticky",
    });

    const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
    io.to(ctx.roomId).emit("note:added", note, inJarCount);
  });

  socket.on("note:pull", async () => {
    if (!ctx.roomId || !ctx.jarId) return;

    const note = await noteQueries.pullRandomNote(pool, ctx.jarId);
    if (!note) {
      socket.emit("pull:rejected", "The jar is empty");
      return;
    }

    io.to(ctx.roomId).emit("note:pulled", note, ctx.memberId ?? socket.id);
  });

  socket.on("note:discard", async (noteId) => {
    if (!ctx.roomId) return;

    const updated = await noteQueries.updateNoteState(pool, noteId, "discarded");
    if (!updated) return;

    io.to(ctx.roomId).emit("note:discarded", noteId);
  });

  socket.on("note:return", async (noteId) => {
    if (!ctx.roomId || !ctx.jarId) return;

    const updated = await noteQueries.updateNoteState(pool, noteId, "in_jar");
    if (!updated) return;

    const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
    io.to(ctx.roomId).emit("note:returned", noteId, inJarCount);
  });
}
