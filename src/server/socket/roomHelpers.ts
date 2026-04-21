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
import * as starQueries from "../db/queries/starredJars";
import type { SocketContext } from "./context";
import type { SocketDeps } from "./deps";
import type { IdleTimeoutManager } from "./idleTimeout";
import type { TypedServer } from "./server";

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
export type DbRoom = NonNullable<Awaited<ReturnType<typeof roomQueries.getRoomByCode>>>;

interface PullAttribution {
  pulledBy?: string | null;
  pulledByUserId?: string | null;
}
interface Viewer {
  userId?: string | null;
  displayName?: string | null;
}

/**
 * Decide whether a pulled row (note or history entry) belongs to the viewer.
 * Prefer user-id match when both sides have it — stable across display-name
 * collisions. Fall back to display-name for anonymous sessions or legacy rows
 * pulled before pulled_by_user_id existed.
 */
export function isPullMine(entry: PullAttribution, viewer: Viewer): boolean {
  if (viewer.userId && entry.pulledByUserId) return entry.pulledByUserId === viewer.userId;
  return entry.pulledBy === viewer.displayName;
}

type JarSummary = {
  name?: string | null;
  config: JarConfig | null;
  appearance: JarAppearance | null;
};

/**
 * Common fields for every note:state payload — counts, jar metadata, and the
 * sealed buffer length so joiners and post-refresh clients stay in sync with
 * the sealed stack. Kept in one place so a new field (e.g. jarName) doesn't
 * have to be wired through two parallel builders.
 */
export async function buildNoteStateShared(
  jar: JarSummary,
  jarId: string,
  roomId: string,
  deps: Pick<SocketDeps, "sealedNotesStore">,
): Promise<{
  inJarCount: number;
  jarName?: string;
  jarConfig?: JarConfig;
  jarAppearance?: JarAppearance;
  sealedCount: number;
  sealedRevealAt: number;
}> {
  const [inJarCount, sealedCount] = await Promise.all([
    noteQueries.countNotesByState(pool, jarId, "in_jar"),
    deps.sealedNotesStore.length(roomId),
  ]);
  return {
    inJarCount,
    jarName: jar.name ?? undefined,
    jarConfig: jar.config ?? undefined,
    jarAppearance: jar.appearance ?? undefined,
    sealedCount,
    sealedRevealAt: jar.config?.sealedRevealCount ?? 0,
  };
}

/**
 * Builds the compact `note:state` payload broadcast on `jar:refresh`. We
 * deliberately omit `pulledNotes` — it's unchanged by jar edits and costs
 * ~200 bytes/note × members. Clients must preserve their existing pulled
 * notes when this field is absent (see NoteStatePayload doc).
 *
 * Retained as a thin sync wrapper for tests that assert the shape without
 * needing a real sealed store.
 */
export function buildJarRefreshPayload(
  jar: { config: JarConfig | null; appearance: JarAppearance | null; name?: string | null },
  inJarCount: number,
) {
  return {
    inJarCount,
    jarName: jar.name ?? undefined,
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
  jar: JarSummary & { ownerId?: string | null },
  jarId: string,
  roomId: string,
  deps: SocketDeps,
  isPrivate: boolean,
  displayName: string | null,
  userId: string | null,
): Promise<void> {
  // Star lookup only when the viewer is signed in and isn't the owner —
  // owners don't star their own jars, anonymous users can't star at all.
  const starLookup =
    userId && jar.ownerId && jar.ownerId !== userId
      ? starQueries.isStarred(pool, userId, jarId)
      : Promise.resolve(false);
  const [shared, pulledNotes, isStarred] = await Promise.all([
    buildNoteStateShared(jar, jarId, roomId, deps),
    noteQueries.listNotesByJar(pool, jarId, "pulled"),
    starLookup,
  ]);
  const filtered = isPrivate
    ? pulledNotes.filter((n) => isPullMine(n, { userId, displayName }))
    : pulledNotes;
  socket.emit("note:state", { ...shared, pulledNotes: filtered, isStarred });
}

export function startIdleTimeout(
  io: TypedServer,
  idleTimeouts: IdleTimeoutManager | undefined,
  roomId: string,
  jarId: string,
  timeoutMinutes: number,
  deps: SocketDeps,
): void {
  if (!idleTimeouts) return;
  idleTimeouts.start(roomId, timeoutMinutes, async (expiredRoomId) => {
    await roomQueries.updateRoomState(pool, expiredRoomId, "closed");
    // Reset pulled notes back into the jar so the next room for this jar
    // starts from a clean state — the previous group disconnected before
    // returning what they pulled, and leaving them "pulled" in the DB
    // surfaces as ghost notes on the next room's table.
    await noteQueries.resetPulledNotesForJar(pool, jarId);
    io.to(expiredRoomId).emit("room:error", "Room closed due to inactivity");
    io.in(expiredRoomId).disconnectSockets();
    await deps.presenceStore.clearRoom(expiredRoomId);
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
