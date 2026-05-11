import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "../../scripts/bootstrap-and-migrate.mjs";

/**
 * Regression guards for the bug that fake-applied 1778717000000_drop_rooms_code
 * on prod. The original orchestration ran markExistingMigrationsApplied
 * unconditionally — so any genuinely-new migration on an existing DB was
 * inserted into pgmigrations BEFORE node-pg-migrate looked at it. node-pg-
 * migrate then saw the row, concluded it was already applied, and skipped
 * the SQL body. pgmigrations lied "done" while the actual schema stayed
 * behind. The freshness gate prevents that recurrence.
 */
describe("bootstrap", () => {
  it("marks migrations as applied only when the schema is freshly loaded", async () => {
    const applySchema = vi.fn().mockResolvedValue(true);
    const markExisting = vi.fn().mockResolvedValue(7);
    const runMigrations = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    const result = await bootstrap({ applySchema, markExisting, runMigrations, log });

    expect(applySchema).toHaveBeenCalledTimes(1);
    expect(markExisting).toHaveBeenCalledTimes(1);
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(result.freshSchema).toBe(true);
  });

  it("SKIPS mark-as-applied on an existing DB (the regression guard)", async () => {
    // The prod-breaking scenario: schema exists, new migration files have
    // been added since last deploy. If mark-as-applied runs here, the new
    // migrations get falsely recorded as done and node-pg-migrate never
    // executes their SQL.
    const applySchema = vi.fn().mockResolvedValue(false);
    const markExisting = vi.fn().mockResolvedValue(0);
    const runMigrations = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    const result = await bootstrap({ applySchema, markExisting, runMigrations, log });

    expect(applySchema).toHaveBeenCalledTimes(1);
    expect(markExisting).not.toHaveBeenCalled();
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(result.freshSchema).toBe(false);
  });

  it("runs node-pg-migrate after applySchema regardless of freshness", async () => {
    // The final phase — applying any genuinely-pending migrations — must
    // run in both modes. On fresh DBs it's typically a no-op (everything
    // was just marked applied); on existing DBs it's the only thing that
    // applies new migrations.
    for (const fresh of [true, false]) {
      const runMigrations = vi.fn().mockResolvedValue(undefined);
      await bootstrap({
        applySchema: vi.fn().mockResolvedValue(fresh),
        markExisting: vi.fn().mockResolvedValue(0),
        runMigrations,
        log: vi.fn(),
      });
      expect(runMigrations, `fresh=${fresh}`).toHaveBeenCalledTimes(1);
    }
  });

  it("logs the existing-DB message so deploy logs are diagnosable", async () => {
    const log = vi.fn();
    await bootstrap({
      applySchema: vi.fn().mockResolvedValue(false),
      markExisting: vi.fn(),
      runMigrations: vi.fn().mockResolvedValue(undefined),
      log,
    });
    const messages = log.mock.calls.map((c) => c[0]).join("\n");
    expect(messages).toMatch(/existing DB|skipping mark-as-applied/i);
  });
});
