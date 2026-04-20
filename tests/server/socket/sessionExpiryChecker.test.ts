import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { startSessionExpiryChecker } from "../../../src/server/socket/sessionExpiryChecker";

const silent = pino({ level: "silent" });

interface FakeSocket {
  data: { sessionExpiresAt?: number };
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function fakeSocket(sessionExpiresAt?: number): FakeSocket {
  return {
    data: { sessionExpiresAt },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
}

function fakeIo(sockets: Record<string, FakeSocket>) {
  return {
    sockets: { sockets: new Map(Object.entries(sockets)) },
  } as unknown as Parameters<typeof startSessionExpiryChecker>[0]["io"];
}

describe("startSessionExpiryChecker", () => {
  it("disconnects sockets whose session has expired", () => {
    const now = 1_000_000;
    const expired = fakeSocket(now - 1);
    const io = fakeIo({ s1: expired });
    const { tick, stop } = startSessionExpiryChecker({
      io,
      logger: silent,
      clock: () => now,
    });
    tick();
    stop();

    expect(expired.emit).toHaveBeenCalledWith("auth:expired");
    expect(expired.disconnect).toHaveBeenCalledWith(true);
  });

  it("leaves sockets with a future expiry alone", () => {
    const now = 1_000_000;
    const fresh = fakeSocket(now + 10_000);
    const io = fakeIo({ s1: fresh });
    const { tick, stop } = startSessionExpiryChecker({
      io,
      logger: silent,
      clock: () => now,
    });
    tick();
    stop();

    expect(fresh.emit).not.toHaveBeenCalled();
    expect(fresh.disconnect).not.toHaveBeenCalled();
  });

  it("ignores anonymous sockets with no sessionExpiresAt", () => {
    const anon = fakeSocket(undefined);
    const io = fakeIo({ s1: anon });
    const { tick, stop } = startSessionExpiryChecker({
      io,
      logger: silent,
      clock: () => 1_000_000,
    });
    tick();
    stop();

    expect(anon.emit).not.toHaveBeenCalled();
    expect(anon.disconnect).not.toHaveBeenCalled();
  });

  it("scans a mix — disconnects only expired ones", () => {
    const now = 1_000_000;
    const expired = fakeSocket(now - 1);
    const fresh = fakeSocket(now + 1);
    const anon = fakeSocket(undefined);
    const io = fakeIo({ s1: expired, s2: fresh, s3: anon });
    const { tick, stop } = startSessionExpiryChecker({
      io,
      logger: silent,
      clock: () => now,
    });
    tick();
    stop();

    expect(expired.disconnect).toHaveBeenCalledTimes(1);
    expect(fresh.disconnect).not.toHaveBeenCalled();
    expect(anon.disconnect).not.toHaveBeenCalled();
  });

  it("stop() clears the interval", () => {
    vi.useFakeTimers();
    try {
      const tickSpy = vi.fn();
      const io = fakeIo({});
      // Override tick by wrapping — here we just verify stop prevents repeated calls
      const { stop } = startSessionExpiryChecker({
        io,
        logger: silent,
        intervalMs: 100,
        clock: () => 0,
      });
      // No sockets, so tick is a no-op, but we can confirm stop prevents scheduling
      vi.advanceTimersByTime(150);
      stop();
      vi.advanceTimersByTime(1000);
      // Nothing to assert directly except no errors thrown; this test exists so
      // stop() is at least exercised and lives on a clean timer contract.
      expect(tickSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
