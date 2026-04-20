import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createAppLogger } from "../../src/server/logger";

function captureStream() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of chunk.toString().split("\n")) {
        if (line.length > 0) lines.push(line);
      }
      cb();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  it("emits newline-delimited JSON", () => {
    const { lines, stream } = captureStream();
    const logger = createAppLogger(stream);
    logger.info({ foo: "bar" }, "hello");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.msg).toBe("hello");
    expect(entry.foo).toBe("bar");
    expect(entry.level).toBe(30);
  });

  it("supports child loggers with bound context", () => {
    const { lines, stream } = captureStream();
    const logger = createAppLogger(stream);
    const child = logger.child({ req_id: "abc", user_id: "u1" });
    child.info("processed");
    const entry = JSON.parse(lines[0]);
    expect(entry.req_id).toBe("abc");
    expect(entry.user_id).toBe("u1");
    expect(entry.msg).toBe("processed");
  });

  it("emits warn and error at the correct numeric levels", () => {
    const { lines, stream } = captureStream();
    const logger = createAppLogger(stream);
    logger.warn("careful");
    logger.error({ err: new Error("boom") }, "failure");
    expect(lines).toHaveLength(2);
    const warn = JSON.parse(lines[0]);
    const err = JSON.parse(lines[1]);
    expect(warn.level).toBe(40);
    expect(err.level).toBe(50);
    expect(err.err?.message).toBe("boom");
  });

  it("emits ISO-8601 timestamps", () => {
    const { lines, stream } = captureStream();
    const logger = createAppLogger(stream);
    logger.info("tick");
    const entry = JSON.parse(lines[0]);
    expect(typeof entry.time).toBe("string");
    expect(Number.isNaN(Date.parse(entry.time))).toBe(false);
  });

  it("respects LOG_LEVEL override", () => {
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    try {
      const { lines, stream } = captureStream();
      const logger = createAppLogger(stream);
      logger.info("should be dropped");
      logger.warn("should appear");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).msg).toBe("should appear");
    } finally {
      process.env.LOG_LEVEL = prev;
    }
  });
});
