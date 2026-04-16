import type { ClientToServerEvents, Room, RoomMember, ServerToClientEvents } from "@shared/types";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as noteQueries from "../db/queries/notes";
import * as roomQueries from "../db/queries/rooms";
import type { SocketContext } from "./context";
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

export function registerRoomHandlers(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
): void {
  socket.on("room:join", async (code, displayName) => {
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

    const member: RoomMember = {
      id: socket.id,
      displayName,
      role: "contributor",
      color: assignColor(roomId),
      connectedAt: new Date().toISOString(),
    };

    members.set(socket.id, member);

    // Load jar config for visibility settings
    const jar = await jarQueries.getJarById(pool, dbRoom.jarId);
    const jarConfig = jar?.config ?? null;

    ctx.roomId = roomId;
    ctx.jarId = dbRoom.jarId;
    ctx.jarConfig = jarConfig;
    ctx.memberId = socket.id;
    ctx.displayName = displayName;

    await socket.join(roomId);

    // Send room state
    socket.emit("room:state", buildRoomState(dbRoom, roomId));

    // Send current note state based on pull visibility
    const inJarCount = await noteQueries.countNotesByState(pool, dbRoom.jarId, "in_jar");
    const isPrivate = jarConfig?.pullVisibility === "private";

    if (isPrivate) {
      // Private mode: only show this user's pulled notes + counts for everyone
      const [allPulled, pullCounts] = await Promise.all([
        noteQueries.listNotesByJar(pool, dbRoom.jarId, "pulled"),
        noteQueries.getPullCounts(pool, dbRoom.jarId),
      ]);
      const myNotes = allPulled.filter((n) => n.pulledBy === socket.id);
      socket.emit("note:state", { inJarCount, pulledNotes: myNotes, pullCounts });
    } else {
      // Shared mode: show all pulled notes
      const pulledNotes = await noteQueries.listNotesByJar(pool, dbRoom.jarId, "pulled");
      socket.emit("note:state", { inJarCount, pulledNotes });
    }

    // Broadcast join to others
    socket.to(roomId).emit("room:member_joined", member);
  });

  socket.on("room:leave", () => handleLeave());
  socket.on("disconnect", () => handleLeave());

  socket.on("cursor:move", (position) => {
    if (!ctx.roomId) return;
    socket.volatile.to(ctx.roomId).emit("cursor:moved", {
      ...position,
      userId: socket.id,
    });
  });

  socket.on("room:lock", async () => {
    if (!ctx.roomId) return;
    await roomQueries.updateRoomState(pool, ctx.roomId, "locked");
    io.to(ctx.roomId).emit("room:locked");
  });

  socket.on("room:unlock", async () => {
    if (!ctx.roomId) return;
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
      }
    }

    socket.to(ctx.roomId).emit("room:member_left", ctx.memberId);
    socket.leave(ctx.roomId);

    ctx.roomId = null;
    ctx.jarId = null;
    ctx.memberId = null;
  }
}
