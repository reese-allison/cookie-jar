type TimeoutCallback = (roomId: string) => void;

interface RoomTimer {
  timeout: ReturnType<typeof setTimeout>;
  durationMs: number;
  onTimeout: TimeoutCallback;
}

export class IdleTimeoutManager {
  private timers = new Map<string, RoomTimer>();

  start(roomId: string, timeoutMinutes: number, onTimeout: TimeoutCallback): void {
    this.stop(roomId);

    const durationMs = timeoutMinutes * 60_000;
    const timeout = setTimeout(() => {
      this.timers.delete(roomId);
      onTimeout(roomId);
    }, durationMs);

    this.timers.set(roomId, { timeout, durationMs, onTimeout });
  }

  resetActivity(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (!timer) return;

    clearTimeout(timer.timeout);
    const newTimeout = setTimeout(() => {
      this.timers.delete(roomId);
      timer.onTimeout(roomId);
    }, timer.durationMs);

    this.timers.set(roomId, { ...timer, timeout: newTimeout });
  }

  stop(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) {
      clearTimeout(timer.timeout);
      this.timers.delete(roomId);
    }
  }
}
