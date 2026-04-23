import type { Socket } from "socket.io";
import { logger } from "../logger";

interface ConnectionLimiter {
  /** Socket.io handshake middleware — rejects the connection when the cap is hit. */
  middleware(socket: Socket, next: (err?: Error) => void): void;
  /** Call on socket disconnect so the counter drops. */
  release(socket: Socket): void;
  /** Exposed for tests. */
  currentCount(ip: string): number;
}

/**
 * Per-pod, per-IP concurrent connection cap. The same IP behind a NAT can
 * legitimately open a handful of sockets (multi-tab, multi-device-on-same-wifi),
 * so the default is generous. Abuse manifests as an IP opening dozens of
 * sockets before the rate limiter can do anything — the cap is the first line
 * of defense, and a cluster-wide cap belongs at the load balancer.
 */
export function createConnectionLimiter(limit = 50): ConnectionLimiter {
  const counts = new Map<string, number>();

  function getIp(socket: Socket): string {
    // socket.io sets handshake.address from the underlying connection. When
    // the server sits behind a trusted proxy this is still the proxy's IP —
    // operators should configure Express `trust proxy` or similar upstream,
    // but per-pod rate-limiting is a best-effort backstop anyway.
    return socket.handshake.address || "unknown";
  }

  return {
    middleware(socket, next) {
      const ip = getIp(socket);
      const current = counts.get(ip) ?? 0;
      if (current >= limit) {
        logger.warn({ ip, current, limit }, "socket connection rejected — per-IP cap");
        next(new Error("Too many connections"));
        return;
      }
      counts.set(ip, current + 1);
      next();
    },

    release(socket) {
      const ip = getIp(socket);
      const current = counts.get(ip) ?? 0;
      if (current <= 1) counts.delete(ip);
      else counts.set(ip, current - 1);
    },

    currentCount(ip) {
      return counts.get(ip) ?? 0;
    },
  };
}
