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
import { createSocketServer } from "./socket/server";
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

app.use(express.json());

// Static files (uploads, sounds) — no rate limit; static assets have their own
// cache headers and rate-limiting them would hurt users on slow networks.
app.use("/uploads", buildUploadsStatic("public/uploads"));
app.use("/sounds", buildSoundsStatic("public/sounds"));

// Socket.io
const io = createSocketServer(httpServer);

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

// Rate-limited mutation + upload routes. Uploads get a tighter budget since
// each call hits disk and can carry several megabytes.
const limiters = buildDefaultLimiters(sharedRedis);
app.use("/api/jars", limiters.write, jarRouter);
app.use("/api/notes", limiters.write, noteRouter);
app.use("/api/rooms", limiters.write, roomRouter);
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
  cleanups: [() => sharedRedis.quit()],
});
registerShutdown();

export { app, httpServer, io };
