interface BucketConfig {
  /** Tokens added per second. */
  ratePerSec: number;
  /** Maximum tokens the bucket can hold (controls burst size). */
  burst: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

// Budgets tuned for a real user's ergonomic maximum — spamming below these
// should never get hit in practice, but a misbehaving or malicious client
// is throttled before it can flood the DB or fan out broadcasts.
const CONFIGS: Record<string, BucketConfig> = {
  "note:add": { ratePerSec: 2, burst: 5 },
  "note:pull": { ratePerSec: 1, burst: 3 },
  "note:discard": { ratePerSec: 2, burst: 4 },
  "note:return": { ratePerSec: 2, burst: 4 },
  "history:get": { ratePerSec: 0.2, burst: 1 }, // 1 per 5 s
  "history:clear": { ratePerSec: 1 / 3, burst: 1 }, // 1 per 3 s — destructive, owner-only
  "jar:refresh": { ratePerSec: 1 / 3, burst: 1 }, // 1 per 3 s
  // Bulk ops touch every pulled row + fan out per-note broadcasts. Keep them
  // tight so repeated clicks don't hammer the DB.
  "note:returnAll": { ratePerSec: 1 / 3, burst: 1 },
  "note:discardAll": { ratePerSec: 1 / 3, burst: 1 },
  // High-frequency ephemeral events. Client throttles to 15 Hz; the server
  // budget is ~double that so honest clients never hit it and a malicious
  // client can't amplify fan-out beyond what a real user would trigger.
  "cursor:move": { ratePerSec: 30, burst: 40 },
  "note:drag": { ratePerSec: 30, burst: 40 },
  "note:drag_end": { ratePerSec: 10, burst: 10 },
};

export interface SocketRateLimiter {
  /** Returns true if the event may proceed, false if it should be rejected. */
  allow(socketId: string, event: string): boolean;
  /** Clears a socket's buckets when it disconnects. */
  dispose(socketId: string): void;
}

/**
 * Monotonic millisecond clock. `performance.now()` is unaffected by wall-
 * clock jumps (NTP adjustments, manual time changes) so token refill math
 * stays correct even if the host's wall clock skips forward or backward.
 * Returns a millisecond value comparable across calls on the same process.
 */
const monotonicMs = (): number => performance.now();

/**
 * Module-level singleton shared across all socket registrations on this pod.
 * Uses in-memory buckets — fine for single-pod correctness. For multi-pod
 * we'd move to Redis counters (Phase 3 work).
 */
export const socketRateLimiter = createSocketRateLimiter();

export function createSocketRateLimiter(clock: () => number = monotonicMs): SocketRateLimiter {
  const buckets = new Map<string, Bucket>();
  const key = (socketId: string, event: string) => `${socketId}:${event}`;

  return {
    allow(socketId, event) {
      const cfg = CONFIGS[event];
      if (!cfg) return true;

      const k = key(socketId, event);
      const now = clock();
      let bucket = buckets.get(k);
      if (!bucket) {
        bucket = { tokens: cfg.burst, lastRefill: now };
        buckets.set(k, bucket);
      }

      const elapsedSec = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(cfg.burst, bucket.tokens + elapsedSec * cfg.ratePerSec);
      bucket.lastRefill = now;

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
      }
      return false;
    },

    dispose(socketId) {
      const prefix = `${socketId}:`;
      for (const k of Array.from(buckets.keys())) {
        if (k.startsWith(prefix)) buckets.delete(k);
      }
    },
  };
}
