import type Redis from "ioredis";
import { logger } from "../logger";

type TimeoutCallback = (roomId: string) => void;

interface RoomTimer {
  timeout: ReturnType<typeof setTimeout>;
  durationMs: number;
  onTimeout: TimeoutCallback;
  /** Timestamp of the last Redis alive-key refresh, for debouncing cursor-storm writes. */
  lastAliveRefreshAt: number;
}

// Cursor packets fire at ~15 Hz per user — left unthrottled, each resetActivity
// would translate 1:1 into a Redis SET. Refreshing at most this often still
// gives the room plenty of headroom before the idle timer fires.
const ALIVE_REFRESH_INTERVAL_MS = 5_000;

/**
 * Tracks idle timeouts for active rooms. Each pod runs its own timers for
 * rooms where it has members. A Redis "alive" key is refreshed on any pod's
 * activity, so when a local timer fires we can confirm the room is *really*
 * idle cluster-wide before closing it. A short-lived Redis lock prevents two
 * pods from both firing the close callback.
 *
 * If no Redis client is provided this degrades to the original single-pod
 * behavior — fine for tests and local dev.
 */
export class IdleTimeoutManager {
  private timers = new Map<string, RoomTimer>();
  private redis: Redis | undefined;

  constructor(redis?: Redis) {
    this.redis = redis;
  }

  start(roomId: string, timeoutMinutes: number, onTimeout: TimeoutCallback): void {
    this.stop(roomId);
    const durationMs = timeoutMinutes * 60_000;
    this.safeRefreshAlive(roomId, durationMs);
    this.scheduleLocal(roomId, {
      durationMs,
      onTimeout,
      lastAliveRefreshAt: Date.now(),
    });
  }

  resetActivity(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (!timer) return;
    const now = Date.now();
    // Only touch Redis every few seconds — the local timer reset below is
    // effectively free, and the alive-key is how remote pods know we're
    // active. Missing a refresh for up to ALIVE_REFRESH_INTERVAL_MS is fine
    // because the key's TTL is 2× the room's idle window (see refreshAlive).
    if (now - timer.lastAliveRefreshAt >= ALIVE_REFRESH_INTERVAL_MS) {
      timer.lastAliveRefreshAt = now;
      this.safeRefreshAlive(roomId, timer.durationMs);
    }
    clearTimeout(timer.timeout);
    this.scheduleLocal(roomId, timer);
  }

  // Wrap the fire-and-forget refresh so a Redis blip logs instead of becoming
  // an unhandled rejection that can take the pod down.
  private safeRefreshAlive(roomId: string, durationMs: number): void {
    this.refreshAlive(roomId, durationMs).catch((err: unknown) => {
      logger.error({ err, roomId }, "idle-timeout refreshAlive failed");
    });
  }

  stop(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) {
      clearTimeout(timer.timeout);
      this.timers.delete(roomId);
    }
  }

  private scheduleLocal(
    roomId: string,
    config: { durationMs: number; onTimeout: TimeoutCallback; lastAliveRefreshAt: number },
    delayMs: number = config.durationMs,
  ): void {
    const timeout = setTimeout(() => {
      this.onFire(roomId).catch((err: unknown) => {
        logger.error({ err, roomId }, "idle-timeout onFire failed");
      });
    }, delayMs);
    this.timers.set(roomId, { ...config, timeout });
  }

  private async onFire(roomId: string): Promise<void> {
    const timer = this.timers.get(roomId);
    if (!timer) return;

    // No Redis → legacy single-pod behavior.
    if (!this.redis) {
      this.timers.delete(roomId);
      timer.onTimeout(roomId);
      return;
    }

    // Someone on another pod moved their cursor recently → reschedule locally.
    // Use the alive-key's remaining TTL instead of a fresh full `durationMs`,
    // otherwise a room with sporadic activity can stay "open" for up to one
    // extra duration past its real last activity. The alive key is written
    // with TTL = 2 × durationMs (see refreshAlive), so remaining/2 gives us
    // back roughly the idle window from the most recent activity.
    const aliveTtlMs = await this.redis.pttl(`room:${roomId}:alive`);
    if (aliveTtlMs > 0) {
      const halved = Math.max(1, Math.floor(aliveTtlMs / 2));
      // Cap at the configured duration so a bad TTL (e.g. a manual refresh
      // that over-set it) can't stretch the timer past the room's policy.
      const remainingMs = Math.min(halved, timer.durationMs);
      this.scheduleLocal(roomId, { ...timer, durationMs: timer.durationMs }, remainingMs);
      return;
    }

    // Try to win the close-lock so only one pod fires the callback. ioredis's
    // typed .set overloads don't combine NX + EX easily, so we drop to call().
    const gotLock = (await this.redis.call(
      "SET",
      `room:${roomId}:closing`,
      "1",
      "EX",
      "60",
      "NX",
    )) as string | null;
    this.timers.delete(roomId);
    if (gotLock === "OK") {
      timer.onTimeout(roomId);
    }
  }

  private async refreshAlive(roomId: string, durationMs: number): Promise<void> {
    if (!this.redis) return;
    // 2× timeout — allows for brief Redis hiccups without closing a live room.
    await this.redis.set(`room:${roomId}:alive`, "1", "PX", durationMs * 2);
  }
}
