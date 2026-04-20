import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = "scripts/check-migrations-safe.mjs";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar";

function isolatedMigrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cj-migrations-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function run(env: Record<string, string>, migrationsDir: string) {
  return spawnSync("node", [SCRIPT], {
    env: { ...process.env, ...env, DATABASE_URL, MIGRATIONS_DIR: migrationsDir },
    encoding: "utf-8",
  });
}

let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  // Ensure pgmigrations table exists so the script has something to read.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pgmigrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      run_on TIMESTAMP NOT NULL
    )
  `);
});

afterAll(async () => {
  await pool.end();
});

describe("check-migrations-safe", () => {
  it("passes when pending migrations are expand-only", () => {
    const dir = isolatedMigrationsDir({
      "9999999999999_add_column.sql":
        "-- Up Migration\nALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;\n-- Down Migration\nALTER TABLE users DROP COLUMN IF EXISTS nickname;\n",
    });
    try {
      const result = run({}, dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Safe to proceed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a pending migration contains DROP TABLE", () => {
    const dir = isolatedMigrationsDir({
      "9999999999998_drop_old.sql":
        "-- Up Migration\nDROP TABLE legacy_junk;\n-- Down Migration\nCREATE TABLE legacy_junk (id UUID);\n",
    });
    try {
      const result = run({}, dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Destructive SQL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when destructive SQL is override-allowed", () => {
    const dir = isolatedMigrationsDir({
      "9999999999997_drop.sql":
        "-- Up Migration\nALTER TABLE users DROP COLUMN deprecated_field;\n-- Down Migration\nALTER TABLE users ADD COLUMN deprecated_field TEXT;\n",
    });
    try {
      const result = run({ ALLOW_DESTRUCTIVE_MIGRATION: "1" }, dir);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("proceeding");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("only flags up-migration SQL, not down-migration SQL", () => {
    const dir = isolatedMigrationsDir({
      "9999999999996_add_only.sql":
        "-- Up Migration\nCREATE TABLE new_thing (id UUID PRIMARY KEY);\n-- Down Migration\nDROP TABLE new_thing;\n",
    });
    try {
      const result = run({}, dir);
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
