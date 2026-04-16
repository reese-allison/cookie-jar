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
import type { IdleTimeoutManager } from "./idleTimeout";
import type { TypedServer } from "./server";

// In-memory presence per room (ephemeral — not persisted to DB)
const roomMembers = new Map<string, Map<string, RoomMember>>();

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

function assignColor(roomId: string): string {
  const members = roomMembers.get(roomId);
  const usedColors = new Set(members ? [...members.values()].map((m) => m.color) : []);
  return (
    COLORS.find((c) => !usedColors.has(c)) ?? COLORS[Math.floor(Math.random() * COLORS.length)]
  );
}

type DbRoom = NonNullable<Awaited<ReturnType<typeof roomQueries.getRoomByCode>>>;

function buildRoomState(dbRoom: DbRoom, roomId: string): Room {
  const members = roomMembers.get(roomId);
  return {
    id: dbRoom.id,
    code: dbRoom.code,
    jarId: dbRoom.jarId,
    state: dbRoom.state,
    maxParticipants: dbRoom.maxParticipants,
    maxViewers: dbRoom.maxViewers,
    idleTimeoutMinutes: dbRoom.idleTimeoutMinutes,
    members: members ? [...members.values()] : [],
    createdAt: dbRoom.createdAt,
  };
}

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function determineRole(ctx: SocketContext, jarOwnerId?: string): RoomMember["role"] {
  if (ctx.isAuthenticated && ctx.userId === jarOwnerId) return "owner";
  if (ctx.isAuthenticated) return "contributor";
  return "viewer";
}

async function sendNoteState(
  socket: TypedSocket,
  jarId: string,
  isPrivate: boolean,
  jarConfig: JarConfig | null,
  jarAppearance: JarAppearance | null,
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
    const myNotes = allPulled.filter((n) => n.pulledBy === socket.id);
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
): void {
  if (!idleTimeouts) return;
  idleTimeouts.start(roomId, timeoutMinutes, async (expiredRoomId) => {
    await roomQueries.updateRoomState(pool, expiredRoomId, "closed");
    io.to(expiredRoomId).emit("room:error", "Room closed due to inactivity");
    io.in(expiredRoomId).disconnectSockets();
    roomMembers.delete(expiredRoomId);
  });
}

export function registerRoomHandlers(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
  idleTimeouts?: IdleTimeoutManager,
): void {
  socket.on("room:join", async (code, displayName) => {
    if (!isValidDisplayName(displayName)) {
      socket.emit("room:error", "Display name must be 1-30 characters");
      return;
    }
    const dbRoom = await roomQueries.getRoomByCode(pool, code);
    if (!dbRoom) {
      socket.emit("room:error", "Room not found");
      return;
    }
    if (dbRoom.state === "closed") {
      socket.emit("room:error", "Room is closed");
      return;
    }

    const roomId = dbRoom.id;

    if (!roomMembers.has(roomId)) {
      roomMembers.set(roomId, new Map());
    }
    const members = roomMembers.get(roomId) ?? new Map();

    if (members.size >= dbRoom.maxParticipants) {
      socket.emit("room:error", "Room is full");
      return;
    }

    const jar = await jarQueries.getJarById(pool, dbRoom.jarId);
    const jarConfig = jar?.config ?? null;
    const role = determineRole(ctx, jar?.ownerId);
    const effectiveName = ctx.displayName ?? displayName;

    const member: RoomMember = {
      id: socket.id,
      displayName: effectiveName,
      role,
      color: assignColor(roomId),
      connectedAt: new Date().toISOString(),
    };

    members.set(socket.id, member);
    ctx.roomId = roomId;
    ctx.jarId = dbRoom.jarId;
    ctx.jarConfig = jarConfig;
    ctx.memberId = socket.id;
    ctx.displayName = effectiveName;
    ctx.role = role;

    await socket.join(roomId);
    socket.emit("room:state", buildRoomState(dbRoom, roomId));
    const jarAppearance = jar?.appearance ?? null;
    await sendNoteState(
      socket,
      dbRoom.jarId,
      jarConfig?.pullVisibility === "private",
      jarConfig,
      jarAppearance,
    );
    socket.to(roomId).emit("room:member_joined", member);

    startIdleTimeout(io, idleTimeouts, roomId, dbRoom.idleTimeoutMinutes);
  });

  socket.on("room:leave", () => handleLeave());
  socket.on("disconnect", () => handleLeave());

  socket.on("cursor:move", (position) => {
    if (!ctx.roomId) return;
    idleTimeouts?.resetActivity(ctx.roomId);
    socket.volatile.to(ctx.roomId).emit("cursor:moved", {
      ...position,
      userId: socket.id,
    });
  });

  socket.on("room:lock", async () => {
    if (!ctx.roomId) return;
    idleTimeouts?.resetActivity(ctx.roomId);
    if (ctx.role !== "owner") {
      socket.emit("room:error", "Only the room owner can lock the room");
      return;
    }
    await roomQueries.updateRoomState(pool, ctx.roomId, "locked");
    io.to(ctx.roomId).emit("room:locked");
  });

  socket.on("room:unlock", async () => {
    if (!ctx.roomId) return;
    if (ctx.role !== "owner") {
      socket.emit("room:error", "Only the room owner can unlock the room");
      return;
    }
    await roomQueries.updateRoomState(pool, ctx.roomId, "open");
    io.to(ctx.roomId).emit("room:unlocked");
  });

  function handleLeave(): void {
    if (!ctx.roomId || !ctx.memberId) return;

    const members = roomMembers.get(ctx.roomId);
    if (members) {
      members.delete(ctx.memberId);
      if (members.size === 0) {
        roomMembers.delete(ctx.roomId);
        idleTimeouts?.stop(ctx.roomId);
      }
    }

    socket.to(ctx.roomId).emit("room:member_left", ctx.memberId);
    socket.leave(ctx.roomId);

    ctx.roomId = null;
    ctx.jarId = null;
    ctx.memberId = null;
  }
}
