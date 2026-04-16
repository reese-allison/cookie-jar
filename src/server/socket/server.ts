import type { Server as HttpServer } from "node:http";
import type { ClientToServerEvents, ServerToClientEvents } from "@shared/types";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { Server } from "socket.io";
import { createSocketContext } from "./context";
import { registerNoteHandlers } from "./noteHandler";
import { registerRoomHandlers } from "./roomHandler";

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function createSocketServer(httpServer: HttpServer): TypedServer {
  const io: TypedServer = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  // Set up Redis adapter for horizontal scaling
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const pubClient = new Redis(redisUrl);
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.on("connection", (socket) => {
    const ctx = createSocketContext();
    registerRoomHandlers(io, socket, ctx);
    registerNoteHandlers(io, socket, ctx);
  });

  return io;
}
