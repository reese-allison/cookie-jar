import type {
  ClientToServerEvents,
  JarAppearance,
  JarConfig,
  Room,
  RoomMember,
  ServerToClientEvents,
} from "@shared/types";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as noteQueries from "../db/queries/notes";
import * as roomQueries from "../db/queries/rooms";
import type { SocketContext } from "./context";
import type { SocketDeps } from "./deps";
import type { IdleTimeoutManager } from "./idleTimeout";
import type { TypedServer } from "./server";

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
export type DbRoom = NonNullable<Awaited<ReturnType<typeof roomQueries.getRoomByCode>>>;

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

export function pickColor(existing: RoomMember[]): string {
  const usedColors = new Set(existing.map((m) => m.color));
  return (
    COLORS.find((c) => !usedColors.has(c)) ?? COLORS[Math.floor(Math.random() * COLORS.length)]
  );
}

export function buildRoomState(dbRoom: DbRoom, members: RoomMember[]): Room {
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

export function determineRole(ctx: SocketContext, jarOwnerId?: string): RoomMember["role"] {
  if (ctx.isAuthenticated && ctx.userId === jarOwnerId) return "owner";
  if (ctx.isAuthenticated) return "contributor";
  return "viewer";
}

/**
 * Cluster-aware: claims the (roomId, userId) slot via the Redis dedup store
 * and disconnects whichever socket used to hold it. If the old socket is on
 * this pod we disconnect locally; otherwise we publish via the kick bus and
 * the pod that owns it disconnects it.
 */
export async function kickPriorSession(
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

export function attachMember(
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

export async function sendNoteState(
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

export function startIdleTimeout(
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
    // A closed room should never be referenced again — drop its cached lock
    // state so the entry doesn't linger in the Map past the idle-sweep window.
    deps.roomStateCache.invalidateRoom(expiredRoomId);
  });
}

export function validateRoomJoin(
  dbRoom: Awaited<ReturnType<typeof roomQueries.getRoomByCode>>,
): string | null {
  if (!dbRoom) return "Room not found";
  if (dbRoom.state === "closed") return "Room is closed";
  // Locked rooms allow members in — they just can't add/discard. Read-mostly mode.
  return null;
}
