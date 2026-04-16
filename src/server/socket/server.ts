import type { Server as HttpServer } from "node:http";
import type { ClientToServerEvents, ServerToClientEvents } from "@shared/types";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { Server } from "socket.io";
import { type SocketAuthData, socketAuthMiddleware } from "./authMiddleware";
import { createSocketContext } from "./context";
import { IdleTimeoutManager } from "./idleTimeout";
import { registerNoteHandlers } from "./noteHandler";
import { registerRoomHandlers } from "./roomHandler";

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5175";

export function createSocketServer(httpServer: HttpServer): TypedServer {
  const io: TypedServer = new Server(httpServer, {
    cors: {
      origin: clientUrl,
      credentials: true,
    },
  });

  // Set up Redis adapter for horizontal scaling
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const pubClient = new Redis(redisUrl);
  const subClient = pubClient.duplicate();
  pubClient.on("error", (err) => console.error("Redis pub error:", err.message));
  subClient.on("error", (err) => console.error("Redis sub error:", err.message));
  io.adapter(createAdapter(pubClient, subClient));

  // Idle timeout manager for auto-closing inactive rooms
  const idleTimeouts = new IdleTimeoutManager();

  // Auth middleware — verifies session cookie on handshake
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    const authData = (socket.data as SocketAuthData) ?? { user: null };
    const ctx = createSocketContext(authData);
    registerRoomHandlers(io, socket, ctx, idleTimeouts);
    registerNoteHandlers(io, socket, ctx);
  });

  return io;
}
