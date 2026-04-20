import { describe, expect, it } from "vitest";
import { buildPoolConfig } from "../../../src/server/db/pool";

describe("buildPoolConfig", () => {
  it("applies sensible defaults when no env overrides are present", () => {
    const cfg = buildPoolConfig({});
    expect(cfg.max).toBe(20);
    expect(cfg.idleTimeoutMillis).toBe(30_000);
    expect(cfg.connectionTimeoutMillis).toBe(5_000);
    expect(cfg.statement_timeout).toBe(10_000);
    expect(cfg.connectionString).toContain("postgresql://");
  });

  it("honors DATABASE_URL env var", () => {
    const cfg = buildPoolConfig({ DATABASE_URL: "postgres://u:p@host:1234/db" });
    expect(cfg.connectionString).toBe("postgres://u:p@host:1234/db");
  });

  it("honors numeric env overrides", () => {
    const cfg = buildPoolConfig({
      PG_POOL_MAX: "50",
      PG_IDLE_TIMEOUT_MS: "60000",
      PG_CONNECTION_TIMEOUT_MS: "2000",
      PG_STATEMENT_TIMEOUT_MS: "15000",
    });
    expect(cfg.max).toBe(50);
    expect(cfg.idleTimeoutMillis).toBe(60_000);
    expect(cfg.connectionTimeoutMillis).toBe(2_000);
    expect(cfg.statement_timeout).toBe(15_000);
  });

  it("ignores invalid numeric overrides and falls back to defaults", () => {
    const cfg = buildPoolConfig({
      PG_POOL_MAX: "not-a-number",
      PG_IDLE_TIMEOUT_MS: "",
      PG_CONNECTION_TIMEOUT_MS: "-5",
    });
    expect(cfg.max).toBe(20);
    expect(cfg.idleTimeoutMillis).toBe(30_000);
    expect(cfg.connectionTimeoutMillis).toBe(5_000);
  });
});
