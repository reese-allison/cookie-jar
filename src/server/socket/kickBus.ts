import type Redis from "ioredis";

const CHANNEL = "cookie-jar:socket-kick";

export interface KickMessage {
  socketId: string;
  reason?: string;
}

export interface KickBus {
  /** Broadcast a kick request cluster-wide. The pod owning the socket disconnects it. */
  publishKick(msg: KickMessage): Promise<void>;
  /** Subscribe. Returns an unsubscribe function. Handler is fired on every kick (incl. this pod). */
  onKick(handler: (msg: KickMessage) => void): () => void;
  /** Close subscriber (used by shutdown). */
  close(): Promise<void>;
}

/**
 * Thin Redis pub/sub wrapper used to coordinate "disconnect socket X" messages
 * across pods. The dedup store decides *who* to kick; this moves the request
 * to the pod that actually owns the socket.
 *
 * Takes a separate `subClient` (duplicated connection) because a subscribed
 * ioredis client can't issue normal commands.
 */
export function createKickBus(pubClient: Redis, subClient: Redis): KickBus {
  let subscribed = false;
  const handlers = new Set<(msg: KickMessage) => void>();

  function ensureSubscribed(): Promise<void> {
    if (subscribed) return Promise.resolve();
    subscribed = true;
    subClient.on("message", (channel, payload) => {
      if (channel !== CHANNEL) return;
      try {
        const msg = JSON.parse(payload) as KickMessage;
        for (const h of handlers) h(msg);
      } catch {
        // Ignore malformed messages — nothing to do.
      }
    });
    return subClient.subscribe(CHANNEL).then(() => undefined);
  }

  return {
    async publishKick(msg) {
      await pubClient.publish(CHANNEL, JSON.stringify(msg));
    },
    onKick(handler) {
      void ensureSubscribed();
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
