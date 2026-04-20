import type { Socket } from "socket.io";
import { describe, expect, it } from "vitest";
import { createConnectionLimiter } from "../../../src/server/socket/connectionLimit";

function fakeSocket(address: string): Socket {
  return { handshake: { address } } as unknown as Socket;
}

function runMiddleware(
  limiter: ReturnType<typeof createConnectionLimiter>,
  ip: string,
): Error | undefined {
  let caught: Error | undefined;
  limiter.middleware(fakeSocket(ip), (err) => {
    caught = err;
  });
  return caught;
}

describe("connectionLimiter", () => {
  it("admits connections under the cap", () => {
    const limiter = createConnectionLimiter(3);
    expect(runMiddleware(limiter, "1.2.3.4")).toBeUndefined();
    expect(runMiddleware(limiter, "1.2.3.4")).toBeUndefined();
    expect(runMiddleware(limiter, "1.2.3.4")).toBeUndefined();
    expect(limiter.currentCount("1.2.3.4")).toBe(3);
  });

  it("rejects once the cap is hit", () => {
    const limiter = createConnectionLimiter(2);
    runMiddleware(limiter, "1.2.3.4");
    runMiddleware(limiter, "1.2.3.4");
    const err = runMiddleware(limiter, "1.2.3.4");
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe("Too many connections");
    // Rejected connection shouldn't be counted.
    expect(limiter.currentCount("1.2.3.4")).toBe(2);
  });

  it("release decrements the counter and deletes at zero", () => {
    const limiter = createConnectionLimiter(5);
    const sock = fakeSocket("1.2.3.4");
    limiter.middleware(sock, () => {});
    limiter.middleware(sock, () => {});
    expect(limiter.currentCount("1.2.3.4")).toBe(2);
    limiter.release(sock);
    expect(limiter.currentCount("1.2.3.4")).toBe(1);
    limiter.release(sock);
    expect(limiter.currentCount("1.2.3.4")).toBe(0);
  });

  it("tracks IPs independently", () => {
    const limiter = createConnectionLimiter(1);
    expect(runMiddleware(limiter, "1.1.1.1")).toBeUndefined();
    expect(runMiddleware(limiter, "2.2.2.2")).toBeUndefined();
    expect(runMiddleware(limiter, "1.1.1.1")).toBeInstanceOf(Error);
    // 2.2.2.2 still has capacity.
    expect(limiter.currentCount("2.2.2.2")).toBe(1);
  });
});
