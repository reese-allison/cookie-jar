import type { Server as HttpServer } from "node:http";
import type { ClientToServerEvents, ServerToClientEvents } from "@shared/types";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { Server } from "socket.io";
import pool from "../db/pool";
import { logger } from "../logger";
import { type SocketAuthData, socketAuthMiddleware } from "./authMiddleware";
import { createCacheBus } from "./cacheBus";
import { createSocketContext } from "./context";
import { createDedupStore } from "./dedupStore";
import type { SocketDeps } from "./deps";
import { IdleTimeoutManager } from "./idleTimeout";
import { createKickBus } from "./kickBus";
import { registerNoteHandlers } from "./noteHandler";
import { createPresenceStore } from "./presenceStore";
import { attachRedisHealthLogger } from "./redisHealthLogger";
import { registerRoomHandlers } from "./roomHandler";
import { createRoomStateCache } from "./roomStateCache";
import { createSealedNotesStore } from "./sealedNotesStore";
import { startSessionExpiryChecker } from "./sessionExpiryChecker";

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5175";

export interface SocketServer {
  io: TypedServer;
  stop(): Promise<void>;
}

export function createSocketServer(httpServer: HttpServer): TypedServer {
  const { io } = buildSocketServer(httpServer);
  return io;
}

export function buildSocketServer(httpServer: HttpServer): SocketServer {
  const io: TypedServer = new Server(httpServer, {
    cors: {
      origin: clientUrl,
      credentials: true,
    },
    // Legit payloads top out at a few hundred bytes (cursor positions, note
    // text ≤ 500 chars). Default is 1 MB which lets a single malicious frame
    // chew a lot of CPU before we can reject it. 16 KB is generous for any
    // real event while still bounded.
    maxHttpBufferSize: 16 * 1024,
  });

  // Set up Redis adapter for horizontal scaling
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const pubClient = new Redis(redisUrl);
  const subClient = pubClient.duplicate();
  // Dedicated client for application state (sealed notes, dedup, presence).
  const stateClient = pubClient.duplicate();
  // Dedicated subscribers for the kick + cache-invalidation buses — a
  // subscribed ioredis client can't issue normal commands, so each bus gets
  // its own. (They could share one subscriber with multiple channels, but
  // separate clients keep error-handling and shutdown per-bus simpler.)
  const kickSubClient = pubClient.duplicate();
  const cacheSubClient = pubClient.duplicate();
  pubClient.on("error", (err) => logger.error({ err, channel: "pub" }, "redis error"));
  subClient.on("error", (err) => logger.error({ err, channel: "sub" }, "redis error"));
  stateClient.on("error", (err) => logger.error({ err, channel: "state" }, "redis error"));
  kickSubClient.on("error", (err) => logger.error({ err, channel: "kick" }, "redis error"));
  cacheSubClient.on("error", (err) => logger.error({ err, channel: "cache" }, "redis error"));
  // Log lifecycle transitions so "Redis went down for N seconds" shows up
  // without needing a metrics dashboard. ioredis auto-reconnects regardless.
  attachRedisHealthLogger(pubClient, logger, "pub");
  attachRedisHealthLogger(subClient, logger, "sub");
  attachRedisHealthLogger(stateClient, logger, "state");
  attachRedisHealthLogger(kickSubClient, logger, "kick");
  attachRedisHealthLogger(cacheSubClient, logger, "cache");
  io.adapter(createAdapter(pubClient, subClient));

  // Idle timeout manager — Redis-backed so cursor activity on one pod keeps
  // another pod's local timer from closing the room prematurely.
  const idleTimeouts = new IdleTimeoutManager(stateClient);

  // Shared Redis-backed state accessed by multiple handlers.
  const kickBus = createKickBus(pubClient, kickSubClient);
  const cacheBus = createCacheBus(pubClient, cacheSubClient);
  const roomStateCache = createRoomStateCache(pool);
  const deps: SocketDeps = {
    sealedNotesStore: createSealedNotesStore(stateClient),
    dedupStore: createDedupStore(stateClient),
    presenceStore: createPresenceStore(stateClient),
    kickBus,
    cacheBus,
    roomStateCache,
  };

  // Subscribe for cross-pod kick requests: the pod that actually owns the
  // socket disconnects it.
  kickBus.onKick(({ socketId, reason }) => {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) return;
    if (reason) sock.emit("room:error", reason);
    sock.disconnect();
  });

  // Cross-pod cache invalidation — a lock/unlock or jar:refresh on any pod
  // drops the matching entry here, so remote changes don't serve stale reads
  // for up to 5s.
  cacheBus.onInvalidate(({ scope, id }) => {
    if (scope === "room") roomStateCache.invalidateRoom(id);
    else if (scope === "jar") roomStateCache.invalidateJar(id);
  });

  // Auth middleware — verifies session cookie on handshake
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    const authData = (socket.data as SocketAuthData) ?? { user: null };
    const ctx = createSocketContext(authData);
    registerRoomHandlers(io, socket, ctx, deps, idleTimeouts);
    registerNoteHandlers(io, socket, ctx, deps);
  });

  // Periodic check for expired sessions on long-lived sockets.
  const sessionChecker = startSessionExpiryChecker({ io, logger });

  return {
    io,
    async stop() {
      sessionChecker.stop();
      roomStateCache.stop();
      await kickBus.close();
      await cacheBus.close();
      await io.close();
      await Promise.all([
        pubClient.quit(),
        subClient.quit(),
        stateClient.quit(),
        kickSubClient.quit(),
        cacheSubClient.quit(),
      ]);
    },
  };
}
