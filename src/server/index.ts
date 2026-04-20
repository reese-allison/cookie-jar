import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import Redis from "ioredis";
import { auth, authPool } from "./auth";
import pool from "./db/pool";
import { logger } from "./logger";
import { buildDefaultLimiters } from "./middleware/rateLimit";
import { applySecurityHeaders } from "./middleware/securityHeaders";
import { buildCompression, buildSoundsStatic, buildUploadsStatic } from "./middleware/static";
import { createHealthRouter } from "./routes/health";
import { jarRouter } from "./routes/jars";
import { noteRouter } from "./routes/notes";
import { roomRouter } from "./routes/rooms";
import { createUploadRouter } from "./routes/uploads";
import { createShutdownHandler } from "./shutdown";
import { buildSocketServer } from "./socket/server";
import { buildStorageFromEnv } from "./storage";

const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5175";

const app = express();
const httpServer = createServer(app);

applySecurityHeaders(app);
app.use(buildCompression());

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  }),
);
app.use(cookieParser());

// better-auth handler — MUST be before express.json() per better-auth docs
app.all("/api/auth/{*splat}", toNodeHandler(auth));

// Explicit body ceiling. The biggest legitimate payload is a jar edit with a
// full sound pack of URLs; 64kb is ample and prevents a slow attacker from
// tying up memory with pathological JSON.
app.use(express.json({ limit: "64kb" }));

// Static files (uploads, sounds) — no rate limit; static assets have their own
// cache headers and rate-limiting them would hurt users on slow networks.
app.use("/uploads", buildUploadsStatic("public/uploads"));
app.use("/sounds", buildSoundsStatic("public/sounds"));

// Socket.io — keep the stop() so shutdown closes the adapter's Redis clients.
const { io, stop: stopSocketServer } = buildSocketServer(httpServer);

// Shared Redis client for health checks + rate-limit store. Keeps rate limits
// cluster-wide correct once we run more than one pod.
const sharedRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
});
sharedRedis.on("error", (err) => logger.error({ err }, "shared redis error"));

// Health checks — mounted before rate limits so k8s probes never 429.
app.use(
  "/api",
  createHealthRouter({
    pool,
    redis: sharedRedis,
    socketsCount: () => io.engine.clientsCount,
  }),
);

// Per-method rate limiting: reads get the generous budget (300/min), writes
// the stricter one (60/min), uploads a tighter 10/min. Applying a single
// limiter at the mount prefix would count `GET /api/rooms/:code` (a join
// lookup) against the write quota.
const limiters = buildDefaultLimiters(sharedRedis);
const readOrWrite = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const handler = req.method === "GET" || req.method === "HEAD" ? limiters.read : limiters.write;
  handler(req, res, next);
};
app.use("/api/jars", readOrWrite, jarRouter);
app.use("/api/notes", readOrWrite, noteRouter);
app.use("/api/rooms", readOrWrite, roomRouter);
const uploadStorage = buildStorageFromEnv();
app.use("/api/uploads", limiters.upload, createUploadRouter(uploadStorage));

const PORT = process.env.PORT ?? 3001;

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, "server listening");
});

const graceMs = Number.parseInt(process.env.SHUTDOWN_GRACE_MS ?? "", 10) || 10_000;
const { register: registerShutdown } = createShutdownHandler({
  httpServer,
  io,
  pools: [pool, authPool],
  logger,
  graceMs,
  cleanups: [() => stopSocketServer(), () => sharedRedis.quit()],
});
registerShutdown();

export { app, httpServer, io };
