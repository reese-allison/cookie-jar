import { logger } from "../logger";

/**
 * Run a promise purely for side-effects without blocking, and log any rejection.
 *
 * Without this wrapper, patterns like `void redis.set(...)` become
 * UnhandledPromiseRejection on any Redis hiccup — Node's default behavior on
 * newer versions is to crash the process. Every fire-and-forget Redis or
 * socket-broadcast call on this path should go through here so ops can see the
 * blip in logs instead of a silent restart.
 */
export function fireAndForget(promise: Promise<unknown>, context: string): void {
  promise.catch((err: unknown) => {
    logger.error({ err, context }, "fire-and-forget rejected");
  });
}
