import type Redis from "ioredis";

type TimeoutCallback = (roomId: string) => void;

interface RoomTimer {
  timeout: ReturnType<typeof setTimeout>;
  durationMs: number;
  onTimeout: TimeoutCallback;
}

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
    void this.refreshAlive(roomId, durationMs);
    this.scheduleLocal(roomId, { durationMs, onTimeout });
  }

  resetActivity(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (!timer) return;
    void this.refreshAlive(roomId, timer.durationMs);
    clearTimeout(timer.timeout);
    this.scheduleLocal(roomId, timer);
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
    config: { durationMs: number; onTimeout: TimeoutCallback },
  ): void {
    const timeout = setTimeout(() => {
      void this.onFire(roomId);
    }, config.durationMs);
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
    const alive = await this.redis.exists(`room:${roomId}:alive`);
    if (alive) {
      this.scheduleLocal(roomId, timer);
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
