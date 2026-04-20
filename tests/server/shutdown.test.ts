import type { Server as HttpServer } from "node:http";
import type { Pool } from "pg";
import pino from "pino";
import type { Server as SocketServer } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import { createShutdownHandler } from "../../src/server/shutdown";

const silentLogger = pino({ level: "silent" });

function fakeHttp(opts: { close?: (cb: (err?: Error) => void) => void } = {}): HttpServer {
  const close = opts.close ?? ((cb: (err?: Error) => void) => setImmediate(() => cb()));
  return { close } as unknown as HttpServer;
}

function fakeIo(close: () => Promise<void> = async () => {}): SocketServer {
  return { close } as unknown as SocketServer;
}

function fakePool(end: () => Promise<void> = async () => {}): Pool {
  return { end } as unknown as Pool;
}

describe("createShutdownHandler", () => {
  it("closes http, then io, then pools, then exits with 0", async () => {
    const order: string[] = [];
    const exit = vi.fn();

    const { shutdown } = createShutdownHandler({
      httpServer: fakeHttp({
        close: (cb) => {
          order.push("http");
          setImmediate(() => cb());
        },
      }),
      io: fakeIo(async () => {
        order.push("io");
      }),
      pools: [
        fakePool(async () => {
          order.push("pool-a");
        }),
        fakePool(async () => {
          order.push("pool-b");
        }),
      ],
      logger: silentLogger,
      exit,
    });

    await shutdown("SIGTERM");
    expect(order).toEqual(["http", "io", "pool-a", "pool-b"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits with 1 if httpServer.close errors", async () => {
    const exit = vi.fn();
    const { shutdown } = createShutdownHandler({
      httpServer: fakeHttp({
        close: (cb) => setImmediate(() => cb(new Error("close failed"))),
      }),
      io: fakeIo(),
      pools: [],
      logger: silentLogger,
      exit,
    });

    await shutdown("SIGTERM");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("is idempotent — concurrent signals only run the sequence once", async () => {
    const exit = vi.fn();
    const httpClose = vi.fn((cb: (err?: Error) => void) => setImmediate(() => cb()));
    const { shutdown } = createShutdownHandler({
      httpServer: fakeHttp({ close: httpClose }),
      io: fakeIo(),
      pools: [],
      logger: silentLogger,
      exit,
    });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(httpClose).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("runs cleanups after pools drain", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const { shutdown } = createShutdownHandler({
      httpServer: fakeHttp({
        close: (cb) => setImmediate(() => cb()),
      }),
      io: fakeIo(async () => {
        order.push("io");
      }),
      pools: [
        fakePool(async () => {
          order.push("pool");
        }),
      ],
      logger: silentLogger,
      exit,
      cleanups: [
        async () => {
          order.push("cleanup-a");
        },
        async () => {
          order.push("cleanup-b");
        },
      ],
    });

    await shutdown("SIGTERM");
    expect(order).toEqual(["io", "pool", "cleanup-a", "cleanup-b"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("register() wires and unwires SIGTERM/SIGINT handlers", () => {
    const { register } = createShutdownHandler({
      httpServer: fakeHttp(),
      io: fakeIo(),
      pools: [],
      logger: silentLogger,
      exit: () => {},
    });
    const sigtermBefore = process.listenerCount("SIGTERM");
    const sigintBefore = process.listenerCount("SIGINT");
    const unregister = register();
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    unregister();
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
  });
});
