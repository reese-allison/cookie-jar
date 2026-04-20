import type { RoomMember } from "@shared/types";
import { isValidDisplayName } from "@shared/validation";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as noteQueries from "../db/queries/notes";
import * as roomQueries from "../db/queries/rooms";
import type { SocketContext } from "./context";
import type { SocketDeps } from "./deps";
import { withErrorHandler } from "./errorHandler";
import type { IdleTimeoutManager } from "./idleTimeout";
import { socketRateLimiter } from "./rateLimit";
import {
  attachMember,
  buildJarRefreshPayload,
  buildRoomState,
  determineRole,
  kickPriorSession,
  pickColor,
  sendNoteState,
  startIdleTimeout,
  type TypedSocket,
  validateRoomJoin,
} from "./roomHelpers";
import type { TypedServer } from "./server";

// Re-exported for tests that still import from here.
export { buildJarRefreshPayload };

export function registerRoomHandlers(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
  deps: SocketDeps,
  idleTimeouts?: IdleTimeoutManager,
): void {
  // biome-ignore lint/suspicious/noExplicitAny: socket handlers have varied signatures
  const safe = (handler: (...args: any[]) => unknown) => withErrorHandler(socket, handler);

  socket.on(
    "room:join",
    safe(async (code: string, displayName: string) => {
      if (!isValidDisplayName(displayName)) {
        socket.emit("room:error", "Display name must be 1-30 characters");
        return;
      }
      // Room codes are stored uppercase. Normalize here too so the socket
      // path matches the REST path — clients typing lowercase should still
      // find the room.
      const dbRoom = await roomQueries.getRoomByCode(pool, code.toUpperCase());
      const joinError = validateRoomJoin(dbRoom);
      if (joinError || !dbRoom) {
        socket.emit("room:error", joinError ?? "Room not found");
        return;
      }

      const roomId = dbRoom.id;
      const members = await deps.presenceStore.getMembers(roomId);

      const jar = await jarQueries.getJarById(pool, dbRoom.jarId);
      const jarConfig = jar?.config ?? null;
      const role = determineRole(ctx, jar?.ownerId);
      const effectiveName = ctx.displayName ?? displayName;

      // Enforce one session per authed user per room: kick any prior socket
      // *before* we try to claim a capacity slot — the old socket still
      // counts toward the cap until it's gone.
      if (ctx.userId) {
        await kickPriorSession(io, deps, roomId, ctx.userId, socket.id);
      }

      const member: RoomMember = {
        id: socket.id,
        displayName: effectiveName,
        role,
        color: pickColor(members),
        connectedAt: new Date().toISOString(),
      };

      // Atomic — the Lua script rejects if the role's bucket is full, so
      // two concurrent joins can't both squeeze past the cap.
      const result = await deps.presenceStore.addMemberIfUnderCap(
        roomId,
        member,
        dbRoom.maxParticipants,
        dbRoom.maxViewers,
      );
      if (!result.ok) {
        socket.emit("room:error", "Room is full");
        return;
      }
      attachMember(ctx, member, roomId, dbRoom.jarId, jarConfig);

      await socket.join(roomId);
      socket.emit("room:state", buildRoomState(dbRoom, result.members));
      const jarAppearance = jar?.appearance ?? null;
      await sendNoteState(
        socket,
        dbRoom.jarId,
        jarConfig?.pullVisibility === "private",
        jarConfig,
        jarAppearance,
        effectiveName,
      );
      socket.to(roomId).emit("room:member_joined", member);

      startIdleTimeout(io, idleTimeouts, roomId, dbRoom.idleTimeoutMinutes, deps);
    }),
  );

  socket.on("room:leave", () => {
    void handleLeave();
  });
  socket.on("disconnect", () => {
    void handleLeave();
    socketRateLimiter.dispose(socket.id);
  });

  socket.on("cursor:move", (position) => {
    if (!ctx.roomId) return;
    // Silent drop — cursor packets are volatile, and cursoring through the
    // "rate_limited" UX for a best-effort stream would be noisy. The budget
    // is set so a human client never hits it.
    if (!socketRateLimiter.allow(socket.id, "cursor:move")) return;
    idleTimeouts?.resetActivity(ctx.roomId);
    socket.volatile.to(ctx.roomId).emit("cursor:moved", {
      ...position,
      userId: socket.id,
    });
  });

  socket.on(
    "room:lock",
    safe(async () => {
      if (!ctx.roomId) return;
      idleTimeouts?.resetActivity(ctx.roomId);
      if (ctx.role !== "owner") {
        socket.emit("room:error", "Only the room owner can lock the room");
        return;
      }
      await roomQueries.updateRoomState(pool, ctx.roomId, "locked");
      deps.roomStateCache.setLocked(ctx.roomId, true);
      // Fire-and-forget: every other pod drops its cached lock state, so the
      // next note:add anywhere sees the new value immediately (not 5s later).
      void deps.cacheBus.publish({ scope: "room", id: ctx.roomId });
      io.to(ctx.roomId).emit("room:locked");
    }),
  );

  socket.on(
    "room:unlock",
    safe(async () => {
      if (!ctx.roomId) return;
      if (ctx.role !== "owner") {
        socket.emit("room:error", "Only the room owner can unlock the room");
        return;
      }
      await roomQueries.updateRoomState(pool, ctx.roomId, "open");
      deps.roomStateCache.setLocked(ctx.roomId, false);
      void deps.cacheBus.publish({ scope: "room", id: ctx.roomId });
      io.to(ctx.roomId).emit("room:unlocked");
    }),
  );

  // Owner requests a re-broadcast of jar state after a REST PATCH (name,
  // appearance, config). A jar edit doesn't change the pulled notes array —
  // only config + appearance. We send the compact delta; clients preserve
  // their existing pulledNotes state.
  socket.on(
    "jar:refresh",
    safe(async () => {
      if (!socketRateLimiter.allow(socket.id, "jar:refresh")) {
        socket.emit("rate_limited", "jar:refresh", 3000);
        return;
      }
      if (!ctx.roomId || !ctx.jarId) return;
      if (ctx.role !== "owner") {
        socket.emit("room:error", "Only the jar owner can update the jar");
        return;
      }
      const jar = await jarQueries.getJarById(pool, ctx.jarId);
      if (!jar) return;
      ctx.jarConfig = jar.config ?? null;
      // Refresh the pod-wide cache so *every* socket in this room (including
      // this one's peers) gets the new config on their next note:pull.
      deps.roomStateCache.invalidateJar(ctx.jarId);
      void deps.cacheBus.publish({ scope: "jar", id: ctx.jarId });
      const [inJarCount, pullCounts] = await Promise.all([
        noteQueries.countNotesByState(pool, ctx.jarId, "in_jar"),
        noteQueries.getPullCounts(pool, ctx.jarId),
      ]);
      io.to(ctx.roomId).emit("note:state", buildJarRefreshPayload(jar, inJarCount, pullCounts));
    }),
  );

  async function handleLeave(): Promise<void> {
    if (!ctx.roomId || !ctx.memberId) return;
    const { roomId, memberId, userId } = ctx;

    await deps.presenceStore.removeMember(roomId, memberId);
    const remaining = await deps.presenceStore.memberCount(roomId);
    if (remaining === 0) {
      await deps.presenceStore.clearRoom(roomId);
      idleTimeouts?.stop(roomId);
      // Fire-and-forget — if it fails, TTL on the key will clean up eventually.
      void deps.sealedNotesStore.clear(roomId);
    }

    if (userId) {
      // Fire-and-forget — compare-and-delete, so a stale release can't clobber
      // a newer tab that already claimed the slot.
      void deps.dedupStore.release(roomId, userId, memberId);
    }

    socket.to(roomId).emit("room:member_left", memberId);
    socket.leave(roomId);

    ctx.roomId = null;
    ctx.jarId = null;
    ctx.memberId = null;
  }
}
