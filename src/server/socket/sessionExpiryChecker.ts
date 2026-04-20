import type { Logger } from "pino";
import type { SocketAuthData } from "./authMiddleware";
import type { TypedServer } from "./server";

export interface SessionExpiryCheckerOptions {
  io: TypedServer;
  logger: Logger;
  /** Scan interval in ms. Default 5 min. */
  intervalMs?: number;
  /** Injectable clock for deterministic tests. */
  clock?: () => number;
}

export interface SessionExpiryChecker {
  /** Run one immediate scan. Exposed for tests. */
  tick(): void;
  /** Clear the interval. Call from graceful shutdown. */
  stop(): void;
}

export function startSessionExpiryChecker(opts: SessionExpiryCheckerOptions): SessionExpiryChecker {
  const { io, logger, intervalMs = 5 * 60_000, clock = Date.now } = opts;

  function tick(): void {
    const now = clock();
    for (const [id, socket] of io.sockets.sockets) {
      const data = socket.data as SocketAuthData | undefined;
      const expiresAt = data?.sessionExpiresAt;
      if (expiresAt && expiresAt <= now) {
        socket.emit("auth:expired");
        socket.disconnect(true);
        logger.info({ socketId: id, expiresAt }, "socket disconnected — session expired");
      }
    }
  }

  const handle = setInterval(tick, intervalMs);
  handle.unref?.();

  return {
    tick,
    stop: () => clearInterval(handle),
  };
}
