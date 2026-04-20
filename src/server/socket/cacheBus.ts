import type Redis from "ioredis";
import { logger } from "../logger";

const CHANNEL = "cookie-jar:cache-invalidate";

export type InvalidationScope = "room" | "jar";

export interface InvalidationMessage {
  scope: InvalidationScope;
  id: string;
}

export interface CacheBus {
  /** Broadcast an invalidation cluster-wide. All pods (including this one) will drop the cached entry. */
  publish(msg: InvalidationMessage): Promise<void>;
  /** Subscribe. Returns an unsubscribe function. */
  onInvalidate(handler: (msg: InvalidationMessage) => void): () => void;
  /** Close the subscriber. */
  close(): Promise<void>;
}

/**
 * Redis pub/sub bus so a lock / unlock / jar:refresh on pod A drops the
 * cached room/jar entry on pods B..N without waiting for the TTL to expire.
 * Same shape as kickBus but for cache keys.
 */
export function createCacheBus(pubClient: Redis, subClient: Redis): CacheBus {
  let subscribed = false;
  const handlers = new Set<(msg: InvalidationMessage) => void>();

  async function ensureSubscribed(): Promise<void> {
    if (subscribed) return;
    subscribed = true;
    subClient.on("message", (channel, payload) => {
      if (channel !== CHANNEL) return;
      try {
        const msg = JSON.parse(payload) as InvalidationMessage;
        for (const h of handlers) h(msg);
      } catch {
        // Malformed — nothing to do.
      }
    });
    await subClient.subscribe(CHANNEL);
  }

  return {
    async publish(msg) {
      await pubClient.publish(CHANNEL, JSON.stringify(msg));
    },
    onInvalidate(handler) {
      ensureSubscribed().catch((err: unknown) => {
        logger.error({ err }, "cacheBus subscribe failed");
      });
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    async close() {
      handlers.clear();
      if (subscribed) {
        await subClient.unsubscribe(CHANNEL);
      }
    },
  };
}
