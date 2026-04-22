import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
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
import { buildCompression, buildSoundsStatic } from "./middleware/static";
import { createHealthRouter } from "./routes/health";
import { jarRouter } from "./routes/jars";
import { noteRouter } from "./routes/notes";
import { roomRouter } from "./routes/rooms";
import { createShutdownHandler } from "./shutdown";
import { setSocketServer } from "./socket/broadcaster";
import { buildSocketServer } from "./socket/server";

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

// Static sound assets — no rate limit; cache headers are on each response.
app.use("/sounds", buildSoundsStatic("public/sounds"));

// Socket.io — keep the stop() so shutdown closes the adapter's Redis clients.
const { io, deps: socketDeps, stop: stopSocketServer } = buildSocketServer(httpServer);
setSocketServer(io, socketDeps.sealedNotesStore);

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
// the stricter one (60/min). Applying a single limiter at the mount prefix
// would count `GET /api/rooms/:code` (a join lookup) against the write quota.
const limiters = buildDefaultLimiters(sharedRedis);
const readOrWrite = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const handler = req.method === "GET" || req.method === "HEAD" ? limiters.read : limiters.write;
  handler(req, res, next);
};
app.use("/api/jars", readOrWrite, jarRouter);
app.use("/api/notes", readOrWrite, noteRouter);
app.use("/api/rooms", readOrWrite, roomRouter);

// 404 for any /api route that didn't match a handler. Without this, Express
// falls through to its default HTML 404 page, breaking clients that expect
// JSON errors everywhere. Non-API requests (static assets) continue through
// express.static and hit real 404s there.
app.use("/api", (_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Not found" });
});

// Serve the built client bundle + SPA fallback for single-VM deploys (Fly,
// VPS, etc.). In dev, Vite serves the client on its own port and this block
// is a no-op because `dist/` doesn't exist. We compute the path once at
// startup so direct-linked client routes (`/room/ABC123`) return index.html
// without a file-existence check per request.
const distDir = path.resolve(process.cwd(), "dist");
const distIndex = path.join(distDir, "index.html");
if (fs.existsSync(distIndex)) {
  app.use(
    express.static(distDir, {
      setHeaders(res, filepath) {
        // index.html must revalidate so fresh deploys ship to users
        // immediately. Every other Vite asset has a content hash in its
        // filename and can be cached indefinitely.
        if (filepath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // SPA fallback — any non-API, non-static route returns index.html so the
  // client-side router handles deep links (e.g. room codes pasted into the
  // address bar). /api, /sounds, and /socket.io are already handled above.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
      return next();
    }
    res.sendFile(distIndex);
  });
  logger.info({ distDir }, "serving built client bundle");
} else {
  logger.info({ distDir }, "no client bundle found — dev mode (Vite serves the client)");
}

// Terminal error handler. Catches unhandled route throws that bypass each
// router's try/catch and anything the body parser rejects (malformed JSON,
// payload too large). Returns the JSON shape every other endpoint emits so
// client error handling stays uniform.
const jsonErrorHandler: express.ErrorRequestHandler = (err, req, res, _next) => {
  const e = err as Error & { status?: number; statusCode?: number };
  const status = e.status ?? e.statusCode ?? 500;
  if (status >= 500) {
    logger.error({ err: e, path: req.path }, "unhandled route error");
  } else {
    logger.warn({ msg: e.message, path: req.path, status }, "request rejected");
  }
  res.status(status).json({ error: e.message || "Internal error" });
};
app.use(jsonErrorHandler);

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
