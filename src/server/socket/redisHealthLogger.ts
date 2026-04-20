import type Redis from "ioredis";
import type { Logger } from "pino";

/**
 * Subscribes to lifecycle events on an ioredis client and logs transitions so
 * operators can see "Redis went down for 15s then came back" in the logs
 * without needing an external metrics stack.
 *
 * ioredis auto-reconnects by default with exponential backoff (no extra
 * config needed). This helper is observability only — it does not change
 * reconnect behavior.
 */
export function attachRedisHealthLogger(client: Redis, logger: Logger, channel: string): void {
  let wentDownAt: number | null = null;

  client.on("ready", () => {
    if (wentDownAt !== null) {
      const recoveredAfterMs = Date.now() - wentDownAt;
      logger.warn({ channel, recoveredAfterMs }, "redis reconnected");
      wentDownAt = null;
    } else {
      logger.info({ channel }, "redis connected");
    }
  });

  client.on("close", () => {
    if (wentDownAt === null) {
      wentDownAt = Date.now();
      logger.warn({ channel }, "redis connection closed — degraded");
    }
  });

  client.on("reconnecting", (delayMs: number) => {
    logger.info({ channel, delayMs }, "redis reconnecting");
  });

  client.on("end", () => {
    logger.error({ channel }, "redis connection ended — no further reconnects");
  });
}
