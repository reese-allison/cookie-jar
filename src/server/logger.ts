import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

function baseOptions(): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
    base: { env: process.env.NODE_ENV ?? "development" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

export function createAppLogger(destination?: DestinationStream): Logger {
  const opts = baseOptions();
  if (destination) return pino(opts, destination);
  // Pretty output only in local dev. Prod and test both emit NDJSON so logs
  // are greppable in CI and structured for aggregators.
  if (!isProd && !isTest) {
    return pino({
      ...opts,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
      },
    });
  }
  return pino(opts);
}

export const logger = createAppLogger();
