import { Router } from "express";
import type Redis from "ioredis";
import type pg from "pg";

export interface HealthDeps {
  pool: pg.Pool;
  redis: Redis;
  socketsCount: () => number;
}

export function createHealthRouter({ pool, redis, socketsCount }: HealthDeps): Router {
  const router = Router();

  // Liveness: never hits upstreams. Kubernetes should not restart a pod just
  // because Redis or Postgres went sideways — readiness handles that.
  router.get("/live", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/ready", async (_req, res) => {
    const [dbResult, cacheResult] = await Promise.allSettled([
      pool.query("SELECT 1"),
      redis.ping(),
    ]);
    const db = dbResult.status === "fulfilled";
    const cache = cacheResult.status === "fulfilled";
    const ready = db && cache;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      db,
      cache,
      sockets: socketsCount(),
    });
  });

  return router;
}
