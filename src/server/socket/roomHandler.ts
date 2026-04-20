import type {
  ClientToServerEvents,
  JarAppearance,
  JarConfig,
  Room,
  RoomMember,
  ServerToClientEvents,
} from "@shared/types";
import { isValidDisplayName } from "@shared/validation";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as noteQueries from "../db/queries/notes";
import * as roomQueries from "../db/queries/rooms";
import type { SocketContext } from "./context";
import type { SocketDeps } from "./deps";
import { withErrorHandler } from "./errorHandler";
import type { IdleTimeoutManager } from "./idleTimeout";
import { socketRateLimiter } from "./rateLimit";
import type { TypedServer } from "./server";

// Presence moved to Redis (PresenceStore) in Phase 3.3 — no per-pod map here.

/**
 * Builds the compact `note:state` payload broadcast on `jar:refresh`. We
 * deliberately omit `pulledNotes` — it's unchanged by jar edits and costs
 * ~200 bytes/note × members. Clients must preserve their existing pulled
 * notes when this field is absent (see NoteStatePayload doc).
 */
export function buildJarRefreshPayload(
  jar: { config: JarConfig | null; appearance: JarAppearance | null },
  inJarCount: number,
  pullCounts: Record<string, number>,
) {
  return {
    inJarCount,
    pullCounts,
    jarConfig: jar.config ?? undefined,
    jarAppearance: jar.appearance ?? undefined,
  };
}

// Dedup moved to Redis (dedupStore) in Phase 3.2 — see src/server/socket/dedupStore.ts

const COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
  "#F1948A",
  "#82E0AA",
  "#F8C471",
  "#AED6F1",
  "#D7BDE2",
  "#A3E4D7",
  "#FAD7A0",
  "#A9CCE3",
  "#D5DBDB",
  "#EDBB99",
];

function pickColor(existing: RoomMember[]): string {
  const usedColors = new Set(existing.map((m) => m.color));
  return (
    COLORS.find((c) => !usedColors.has(c)) ?? COLORS[Math.floor(Math.random() * COLORS.length)]
  );
}

type DbRoom = NonNullable<Awaited<ReturnType<typeof roomQueries.getRoomByCode>>>;

function buildRoomState(dbRoom: DbRoom, members: RoomMember[]): Room {
  return {
    id: dbRoom.id,
    code: dbRoom.code,
    jarId: dbRoom.jarId,
    state: dbRoom.state,
    maxParticipants: dbRoom.maxParticipants,
    maxViewers: dbRoom.maxViewers,
    idleTimeoutMinutes: dbRoom.idleTimeoutMinutes,
    members,
    createdAt: dbRoom.createdAt,
  };
}

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function determineRole(ctx: SocketContext, jarOwnerId?: string): RoomMember["role"] {
  if (ctx.isAuthenticated && ctx.userId === jarOwnerId) return "owner";
  if (ctx.isAuthenticated) return "contributor";
  return "viewer";
}

function hasCapacity(members: RoomMember[], role: RoomMember["role"], dbRoom: DbRoom) {
  if (role === "viewer") {
    return members.filter((m) => m.role === "viewer").length < dbRoom.maxViewers;
  }
  return members.filter((m) => m.role !== "viewer").length < dbRoom.maxParticipants;
}

/**
 * Cluster-aware: claims the (roomId, userId) slot via the Redis dedup store
 * and disconnects whichever socket used to hold it. If the old socket is on
 * this pod we disconnect locally; otherwise we publish via the kick bus and
 * the pod that owns it disconnects it.
 */
async function kickPriorSession(
  io: TypedServer,
  deps: SocketDeps,
  roomId: string,
  userId: string,
  newSocketId: string,
): Promise<void> {
  const prior = await deps.dedupStore.claim(roomId, userId, newSocketId);
  if (!prior || prior === newSocketId) return;

  const localOld = io.sockets.sockets.get(prior);
  if (localOld) {
    localOld.emit("room:error", "Signed in from another tab");
    localOld.disconnect();
    await deps.presenceStore.removeMember(roomId, prior);
  } else {
    await deps.kickBus.publishKick({
      socketId: prior,
      reason: "Signed in from another tab",
    });
  }
}

function attachMember(
  ctx: SocketContext,
  member: RoomMember,
  roomId: string,
  jarId: string,
  jarConfig: JarConfig | null,
): void {
  ctx.roomId = roomId;
  ctx.jarId = jarId;
  ctx.jarConfig = jarConfig;
  ctx.memberId = member.id;
  ctx.displayName = member.displayName;
  ctx.role = member.role;
}

async function sendNoteState(
  socket: TypedSocket,
  jarId: string,
  isPrivate: boolean,
  jarConfig: JarConfig | null,
  jarAppearance: JarAppearance | null,
  displayName: string | null,
): Promise<void> {
  const shared = {
    jarConfig: jarConfig ?? undefined,
    jarAppearance: jarAppearance ?? undefined,
  };
  const inJarCount = await noteQueries.countNotesByState(pool, jarId, "in_jar");
  if (isPrivate) {
    const [allPulled, pullCounts] = await Promise.all([
      noteQueries.listNotesByJar(pool, jarId, "pulled"),
      noteQueries.getPullCounts(pool, jarId),
    ]);
    // pulledBy is stored as the user's displayName (see pullRandomNote caller)
    const myNotes = displayName ? allPulled.filter((n) => n.pulledBy === displayName) : [];
    socket.emit("note:state", { inJarCount, pulledNotes: myNotes, pullCounts, ...shared });
  } else {
    const pulledNotes = await noteQueries.listNotesByJar(pool, jarId, "pulled");
    socket.emit("note:state", { inJarCount, pulledNotes, ...shared });
  }
}

function startIdleTimeout(
  io: TypedServer,
  idleTimeouts: IdleTimeoutManager | undefined,
  roomId: string,
  timeoutMinutes: number,
  deps: SocketDeps,
): void {
  if (!idleTimeouts) return;
  idleTimeouts.start(roomId, timeoutMinutes, async (expiredRoomId) => {
    await roomQueries.updateRoomState(pool, expiredRoomId, "closed");
    io.to(expiredRoomId).emit("room:error", "Room closed due to inactivity");
    io.in(expiredRoomId).disconnectSockets();
    await deps.presenceStore.clearRoom(expiredRoomId);
  });
}

function validateRoomJoin(
  dbRoom: Awaited<ReturnType<typeof roomQueries.getRoomByCode>>,
): string | null {
  if (!dbRoom) return "Room not found";
  if (dbRoom.state === "closed") return "Room is closed";
  // Locked rooms allow members in — they just can't add/discard. Read-mostly mode.
  return null;
}

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
      const dbRoom = await roomQueries.getRoomByCode(pool, code);
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

      if (!hasCapacity(members, role, dbRoom)) {
        socket.emit("room:error", "Room is full");
        return;
      }

      // Enforce one session per authed user per room: kick any prior socket.
      // Cluster-aware via Redis + pub/sub — see dedupStore + kickBus.
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

      await deps.presenceStore.addMember(roomId, member);
      attachMember(ctx, member, roomId, dbRoom.jarId, jarConfig);

      await socket.join(roomId);
      // Refetch so new member is included in room:state we send back.
      const currentMembers = await deps.presenceStore.getMembers(roomId);
      socket.emit("room:state", buildRoomState(dbRoom, currentMembers));
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
      io.to(ctx.roomId).emit("room:unlocked");
    }),
  );

  // Owner requests a re-broadcast of jar state after a REST PATCH (name,
  // appearance, config). A jar edit doesn't change the pulled notes array —
  // only config + appearance. We used to re-broadcast the full pulledNotes[]
  // (~1MB fanout on 50-user rooms with 100 notes); now we send only the
  // compact delta and clients keep their existing pulledNotes state.
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
      // this one's peers) gets the new config on their next note:pull, not
      // just whoever triggered the refresh.
      deps.roomStateCache.invalidateJar(ctx.jarId);
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
