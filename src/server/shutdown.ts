import type { Server as HttpServer } from "node:http";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { Server as SocketServer } from "socket.io";

interface ShutdownDeps {
  httpServer: HttpServer;
  io: SocketServer;
  pools: Pool[];
  logger: Logger;
  graceMs?: number;
  exit?: (code: number) => void;
  /** Extra async cleanups (Redis clients, timers, etc.) run after pools drain. */
  cleanups?: Array<() => Promise<unknown>>;
}

export function createShutdownHandler(deps: ShutdownDeps) {
  const {
    httpServer,
    io,
    pools,
    logger,
    graceMs = 10_000,
    exit = (c: number) => process.exit(c),
    cleanups = [],
  } = deps;
  let running = false;

  async function shutdown(signal: string): Promise<void> {
    if (running) return;
    running = true;
    logger.info({ signal }, "shutdown starting");

    const timer = setTimeout(() => {
      logger.error({ graceMs }, "shutdown grace window exceeded");
      exit(1);
    }, graceMs);
    timer.unref?.();

    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await io.close();
      await Promise.all(pools.map((p) => p.end()));
      await Promise.all(cleanups.map((fn) => fn()));
      clearTimeout(timer);
      logger.info("shutdown complete");
      exit(0);
    } catch (err) {
      clearTimeout(timer);
      logger.error({ err }, "shutdown error");
      exit(1);
    }
  }

  function register(): () => void {
    const onTerm = () => {
      void shutdown("SIGTERM");
    };
    const onInt = () => {
      void shutdown("SIGINT");
    };
    process.on("SIGTERM", onTerm);
    process.on("SIGINT", onInt);
    return () => {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    };
  }

  return { shutdown, register };
}
