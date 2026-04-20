import { MAX_NOTES_PER_JAR, NOTE_STYLES } from "@shared/constants";
import type { ClientToServerEvents, Note, ServerToClientEvents } from "@shared/types";
import { isValidNoteText, isValidUrl } from "@shared/validation";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as noteQueries from "../db/queries/notes";
import * as pullHistoryQueries from "../db/queries/pullHistory";
import { withTransaction } from "../db/transaction";
import type { SocketContext } from "./context";
import type { SocketDeps } from "./deps";
import { withErrorHandler } from "./errorHandler";
import { socketRateLimiter } from "./rateLimit";
import type { TypedServer } from "./server";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function requireContributor(ctx: SocketContext, socket: TypedSocket): boolean {
  if (!ctx.isAuthenticated || ctx.role === "viewer") {
    socket.emit("room:error", "Sign in to participate");
    return false;
  }
  return true;
}

/** Validate + normalize incoming note input. Emits room:error and returns null on failure. */
function validateNoteInput(
  socket: TypedSocket,
  input: { text: string; url?: string; style?: string },
): { text: string; url?: string; style: Note["style"] } | null {
  if (!isValidNoteText(input.text)) {
    socket.emit("room:error", "Note text must be 1-500 characters");
    return null;
  }
  if (input.url && !isValidUrl(input.url)) {
    socket.emit("room:error", "Invalid URL");
    return null;
  }
  const style = NOTE_STYLES.includes(input.style as (typeof NOTE_STYLES)[number])
    ? (input.style as Note["style"])
    : "sticky";
  return { text: input.text, url: input.url, style };
}

/**
 * Pulls lock state from the pod's TTL cache (see roomStateCache). The cache is
 * invalidated immediately on room:lock/unlock, so same-pod reads are coherent
 * and cross-pod ones converge within the TTL.
 */
async function isRoomLocked(ctx: SocketContext, deps: SocketDeps): Promise<boolean> {
  if (!ctx.roomId) return false;
  return deps.roomStateCache.getLocked(ctx.roomId);
}

export function registerNoteHandlers(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
  deps: SocketDeps,
): void {
  // biome-ignore lint/suspicious/noExplicitAny: socket handlers have varied signatures
  const safe = (handler: (...args: any[]) => unknown) => withErrorHandler(socket, handler);

  function guardRate(event: string): boolean {
    if (!socketRateLimiter.allow(socket.id, event)) {
      // retryInMs is a hint for the client UI; 1 s is conservative for all
      // configured buckets (slowest is jar:refresh at 3 s, fastest note:* at
      // 500 ms). Clients can choose to honor or ignore it.
      socket.emit("rate_limited", event, 1000);
      return false;
    }
    return true;
  }

  socket.on(
    "note:add",
    safe(async (noteInput: { text: string; url?: string; style?: string }) => {
      if (!guardRate("note:add")) return;
      if (!ctx.roomId || !ctx.jarId) return;
      if (!requireContributor(ctx, socket)) return;
      if (await isRoomLocked(ctx, deps)) {
        socket.emit("room:error", "The jar is locked — no new notes can be added");
        return;
      }
      const validated = validateNoteInput(socket, noteInput);
      if (!validated) return;

      const existing = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
      if (existing >= MAX_NOTES_PER_JAR) {
        socket.emit("room:error", `Jar is full (${MAX_NOTES_PER_JAR} notes max)`);
        return;
      }

      const note = await noteQueries.createNote(pool, {
        jarId: ctx.jarId,
        text: validated.text,
        url: validated.url,
        style: validated.style,
        authorId: ctx.userId ?? undefined,
      });

      // We just inserted one row and already counted the prior total, so a
      // second COUNT(*) would only duplicate work.
      io.to(ctx.roomId).emit("note:added", note, existing + 1);
    }),
  );

  socket.on(
    "note:pull",
    safe(async () => {
      if (!guardRate("note:pull")) return;
      const { roomId, jarId } = ctx;
      if (!roomId || !jarId) return;
      if (!requireContributor(ctx, socket)) return;

      const pulledBy = ctx.displayName ?? ctx.memberId ?? socket.id;
      // Pull + history must commit together: a note marked "pulled" without a
      // history row would show up as pulled to peers but never appear in the
      // history feed, and we couldn't audit who got it.
      const note = await withTransaction(pool, async (client) => {
        const pulled = await noteQueries.pullRandomNote(client, jarId, pulledBy);
        if (!pulled) return null;
        await pullHistoryQueries.recordPull(client, {
          jarId,
          noteId: pulled.id,
          pulledBy,
          roomId,
        });
        return pulled;
      });
      if (!note) {
        socket.emit("pull:rejected", "The jar is empty");
        return;
      }

      // Read config from the pod's cache — ctx.jarConfig is set at join time
      // and goes stale when the owner edits the jar via REST + jar:refresh.
      const { config: liveConfig } = await deps.roomStateCache.getJar(jarId);
      const isSealed = liveConfig?.noteVisibility === "sealed";
      const isPrivate = liveConfig?.pullVisibility === "private";

      if (isSealed) {
        const inJarCount = await noteQueries.countNotesByState(pool, jarId, "in_jar");
        await handleSealedPull(io, ctx, note, pulledBy, inJarCount, deps, liveConfig);
      } else if (isPrivate) {
        socket.emit("note:pulled", note, pulledBy);
        const [inJarCount, pullCounts] = await Promise.all([
          noteQueries.countNotesByState(pool, jarId, "in_jar"),
          noteQueries.getPullCounts(pool, jarId),
        ]);
        // Count-only update to peers — pulledNotes omitted so clients preserve their own state.
        socket.to(roomId).emit("note:state", { inJarCount, pullCounts });
      } else {
        io.to(roomId).emit("note:pulled", note, pulledBy);
      }
    }),
  );

  socket.on(
    "note:discard",
    safe(async (noteId: string) => {
      if (!guardRate("note:discard")) return;
      if (!ctx.roomId || !ctx.jarId) return;
      if (!requireContributor(ctx, socket)) return;
      if (await isRoomLocked(ctx, deps)) {
        socket.emit("room:error", "The jar is locked — notes can't be discarded");
        return;
      }

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
      if (!guardRate("note:return")) return;
      if (!ctx.roomId || !ctx.jarId) return;
      if (!requireContributor(ctx, socket)) return;

      const updated = await noteQueries.updateNoteStateIfInJar(pool, noteId, ctx.jarId, "in_jar");
      if (!updated) return;

      const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
      io.to(ctx.roomId).emit("note:returned", noteId, inJarCount);
    }),
  );

  // Ephemeral drag position broadcasts. No DB state — just relayed to peers so
  // the group sees the note moving in real time. Volatile for move updates
  // (drop intermediate packets if client is slow) so buffering can't build up.
  socket.on("note:drag", (noteId: string, mx: number, my: number) => {
    if (!ctx.roomId) return;
    socket.volatile.to(ctx.roomId).emit("note:drag", noteId, socket.id, mx, my);
  });

  socket.on("note:drag_end", (noteId: string) => {
    if (!ctx.roomId) return;
    socket.to(ctx.roomId).emit("note:drag_end", noteId, socket.id);
  });

  socket.on(
    "history:get",
    safe(async () => {
      if (!guardRate("history:get")) return;
      if (!ctx.jarId) return;
      const entries = await pullHistoryQueries.getHistory(pool, ctx.jarId);
      const { config } = await deps.roomStateCache.getJar(ctx.jarId);
      const isPrivate = config?.pullVisibility === "private";
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

async function handleSealedPull(
  io: TypedServer,
  ctx: SocketContext,
  note: Note,
  pulledBy: string,
  inJarCount: number,
  deps: SocketDeps,
  liveConfig: { sealedRevealCount?: number } | null,
): Promise<void> {
  if (!ctx.roomId) return;
  const revealAt = liveConfig?.sealedRevealCount ?? 1;
  const len = await deps.sealedNotesStore.push(ctx.roomId, note);
  io.to(ctx.roomId).emit("note:sealed", pulledBy, len, revealAt, inJarCount);
  if (len >= revealAt) {
    // Atomic in Redis — only one pod wins the drain + emit.
    const revealed = await deps.sealedNotesStore.revealIfReady(ctx.roomId, revealAt);
    if (revealed.length > 0) {
      io.to(ctx.roomId).emit("note:reveal", revealed);
    }
  }
}
