import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import type Redis from "ioredis";
import { RedisStore, type SendCommandFn } from "rate-limit-redis";

export interface RateLimiterConfig {
  /** Window size in milliseconds. */
  windowMs: number;
  /** Max requests per IP in the window. */
  limit: number;
  /** Prefix for Redis keys so limiters don't collide. */
  prefix: string;
  /** Optional Redis client. Falls back to in-memory if omitted (fine for tests + single-pod dev). */
  redis?: Redis;
}

export function buildRateLimiter(cfg: RateLimiterConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs: cfg.windowMs,
    limit: cfg.limit,
    // Use draft-6 combined headers (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset).
    // Draft-7 merges these into a single RFC 8941 header which is harder for
    // clients and proxies to consume right now.
    standardHeaders: true,
    legacyHeaders: false,
    store: cfg.redis
      ? new RedisStore({
          sendCommand: ((...args: [string, ...string[]]) =>
            (cfg.redis as Redis).call(...args)) as unknown as SendCommandFn,
          prefix: `rl:${cfg.prefix}:`,
        })
      : undefined,
  });
}

// Sensible defaults that callers can override via env if needed later.
export const DEFAULT_LIMITS = {
  read: { windowMs: 60_000, limit: 300 },
  write: { windowMs: 60_000, limit: 60 },
  upload: { windowMs: 60_000, limit: 10 },
} as const;

export function buildDefaultLimiters(redis?: Redis) {
  return {
    read: buildRateLimiter({ ...DEFAULT_LIMITS.read, prefix: "read", redis }),
    write: buildRateLimiter({ ...DEFAULT_LIMITS.write, prefix: "write", redis }),
    upload: buildRateLimiter({ ...DEFAULT_LIMITS.upload, prefix: "upload", redis }),
  };
}
