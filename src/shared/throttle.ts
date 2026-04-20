/**
 * Returns a predicate that gates high-frequency side effects to at most one
 * per `intervalMs`. Returns true if the caller should proceed, false if it
 * should drop this tick. Used for cursor:move and note:drag emitters so a
 * client doesn't flood the socket and the server's volatile channel.
 *
 * The clock is injectable to make behavior deterministic under fake timers
 * or injected-time tests.
 */
export function createThrottle(intervalMs: number, clock: () => number = Date.now): () => boolean {
  // -Infinity so the first call always passes regardless of what clock() returns.
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const now = clock();
    if (now - last < intervalMs) return false;
    last = now;
    return true;
  };
}
