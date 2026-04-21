import type { Note, NoteStatePayload } from "@shared/types";
import pool from "../db/pool";
import * as noteQueries from "../db/queries/notes";
import * as roomQueries from "../db/queries/rooms";
import { logger } from "../logger";
import type { SealedNotesStore } from "./sealedNotesStore";
import type { TypedServer } from "./server";

/**
 * Thin facade that lets REST routes emit socket events to active rooms
 * without threading the `io` instance through the router constructors. The
 * server entry point calls `setSocketServer(io)` after `buildSocketServer`;
 * callers then use `broadcastToJarRooms` / `disconnectJarRooms` directly.
 *
 * Safe to call before the server is up (returns silently) so tests that
 * exercise only the REST surface don't have to mount socket.io.
 */

let io: TypedServer | null = null;
let sealedStore: SealedNotesStore | null = null;

export function setSocketServer(server: TypedServer, store?: SealedNotesStore): void {
  io = server;
  if (store) sealedStore = store;
}

/** Test-only escape hatch so each suite can reset between runs. */
export function resetSocketServer(): void {
  io = null;
  sealedStore = null;
}

/**
 * Drop `noteId` from every active room's sealed buffer for this jar. Called
 * from REST delete / state-change routes so a deleted or no-longer-pulled
 * note can't surface as a zombie on the next reveal.
 *
 * Silent no-op when the socket server isn't up (tests that skip socket
 * wiring) or the jar has no active rooms.
 */
export async function removeFromSealedBuffers(jarId: string, noteId: string): Promise<void> {
  if (!io || !sealedStore) return;
  try {
    const rooms = await roomQueries.listActiveRoomsForJar(pool, jarId);
    await Promise.all(rooms.map((r) => sealedStore?.remove(r.id, noteId)));
  } catch (err) {
    logger.error({ err, jarId, noteId }, "removeFromSealedBuffers failed");
  }
}

/**
 * Replace a note's buffered snapshot across every active room. Used by PATCH
 * /notes/:id so a text edit doesn't reveal with stale content.
 */
export async function updateSealedBuffers(note: Note): Promise<void> {
  if (!io || !sealedStore) return;
  try {
    const rooms = await roomQueries.listActiveRoomsForJar(pool, note.jarId);
    await Promise.all(rooms.map((r) => sealedStore?.updateInBuffer(r.id, note)));
  } catch (err) {
    logger.error({ err, jarId: note.jarId, noteId: note.id }, "updateSealedBuffers failed");
  }
}

/**
 * Emit a compact `note:state` to every open room for this jar. Used after REST
 * mutations (POST /api/notes, DELETE /api/notes/:id, POST /api/notes/bulk-import)
 * so clients don't stay stuck on stale counts.
 */
export async function broadcastJarNoteState(
  jarId: string,
  extras: Partial<NoteStatePayload> = {},
): Promise<void> {
  if (!io) return;
  const rooms = await roomQueries.listActiveRoomsForJar(pool, jarId);
  if (rooms.length === 0) return;
  const inJarCount = await noteQueries.countNotesByState(pool, jarId, "in_jar");
  const payload: NoteStatePayload = { inJarCount, ...extras };
  for (const room of rooms) {
    io.to(room.id).emit("note:state", payload);
  }
}

/**
 * Broadcast a single updated note back to its rooms. Used by PATCH /notes/:id
 * so peers see the new text / state without waiting for a jar:refresh. Emits
 * `note:updated` — a single-note upsert that clients merge by id. Do NOT
 * reuse `note:state` for this: that event's `pulledNotes` field means
 * "authoritative full list" and sending one note would blank every other
 * pulled note from peers' UIs.
 */
export async function broadcastNoteUpdated(note: Note): Promise<void> {
  if (!io) return;
  const rooms = await roomQueries.listActiveRoomsForJar(pool, note.jarId);
  if (rooms.length === 0) return;
  for (const room of rooms) {
    io.to(room.id).emit("note:updated", note);
  }
}

/**
 * Close every active room for a jar: broadcast an error, disconnect every
 * socket in the room, and mark the room state closed in the DB. Called when
 * the owner deletes the jar so live clients don't keep interacting with a
 * jar that's about to be FK-cascade-deleted.
 */
export async function disconnectJarRooms(jarId: string, reason: string): Promise<void> {
  if (!io) return;
  try {
    const rooms = await roomQueries.listActiveRoomsForJar(pool, jarId);
    for (const room of rooms) {
      io.to(room.id).emit("room:error", reason);
      io.in(room.id).disconnectSockets();
      await roomQueries.updateRoomState(pool, room.id, "closed");
    }
  } catch (err) {
    logger.error({ err, jarId }, "disconnectJarRooms failed");
  }
}
