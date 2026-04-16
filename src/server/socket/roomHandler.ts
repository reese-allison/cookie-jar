import type { ClientToServerEvents, Room, RoomMember, ServerToClientEvents } from "@shared/types";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as roomQueries from "../db/queries/rooms";
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

export function registerRoomHandlers(io: TypedServer, socket: TypedSocket): void {
  let currentRoomId: string | null = null;
  let currentMemberId: string | null = null;

  socket.on("room:join", async (code, displayName) => {
    const dbRoom = await roomQueries.getRoomByCode(pool, code);
    if (!dbRoom) {
      return;
    }

    if (dbRoom.state === "closed") {
      return;
    }

    const roomId = dbRoom.id;

    // Initialize room members map if needed
    if (!roomMembers.has(roomId)) {
      roomMembers.set(roomId, new Map());
    }
    const members = roomMembers.get(roomId) ?? new Map();

    // Check capacity
    if (members.size >= dbRoom.maxParticipants) {
      return;
    }

    // Create member
    const member: RoomMember = {
      id: socket.id,
      displayName,
      role: "contributor",
      color: assignColor(roomId),
      connectedAt: new Date().toISOString(),
    };

    members.set(socket.id, member);
    currentRoomId = roomId;
    currentMemberId = socket.id;

    // Join the Socket.io room
    await socket.join(roomId);

    // Send full room state to the joining user
    socket.emit("room:state", buildRoomState(dbRoom, roomId));

    // Broadcast to others that someone joined
    socket.to(roomId).emit("room:member_joined", member);
  });

  socket.on("room:leave", () => {
    handleLeave();
  });

  socket.on("disconnect", () => {
    handleLeave();
  });

  socket.on("cursor:move", (position) => {
    if (!currentRoomId) return;
    socket.volatile.to(currentRoomId).emit("cursor:moved", {
      ...position,
      userId: socket.id,
    });
  });

  socket.on("room:lock", async () => {
    if (!currentRoomId) return;
    await roomQueries.updateRoomState(pool, currentRoomId, "locked");
    io.to(currentRoomId).emit("room:locked");
  });

  socket.on("room:unlock", async () => {
    if (!currentRoomId) return;
    await roomQueries.updateRoomState(pool, currentRoomId, "open");
    io.to(currentRoomId).emit("room:unlocked");
  });

  function handleLeave(): void {
    if (!currentRoomId || !currentMemberId) return;

    const members = roomMembers.get(currentRoomId);
    if (members) {
      members.delete(currentMemberId);
      if (members.size === 0) {
        roomMembers.delete(currentRoomId);
      }
    }

    socket.to(currentRoomId).emit("room:member_left", currentMemberId);
    socket.leave(currentRoomId);

    currentRoomId = null;
    currentMemberId = null;
  }
}
