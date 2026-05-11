#!/usr/bin/env node
// Release-time DB setup for Fly / any fresh-cluster deploy.
//
// Fly Postgres starts empty — it doesn't run docker-entrypoint-initdb.d
// the way the local docker-compose does, so src/server/db/schema.sql
// never gets applied automatically. This script handles both first-time
// bootstrap AND ongoing deploys:
//
//   1. If `users` table is missing → apply schema.sql once.
//   2. ONLY when the schema was just loaded (fresh DB): mark every
//      existing migration file as already applied. Per CLAUDE.md policy,
//      schema.sql is kept in sync with the current target state, so every
//      migration is already reflected there. Running them again would
//      collide on constraints/indexes/columns that schema.sql created
//      with implicit names.
//   3. Run node-pg-migrate up — picks up any genuinely new migrations
//      added after the baseline.
//
// The freshness gate at step 2 is critical: on an EXISTING DB, marking
// new migrations as applied without running them is the bug that
// fake-applied 1778717000000_drop_rooms_code in prod. See the test in
// `tests/scripts/bootstrap-and-migrate.test.ts`.
//
// Idempotent on existing DBs: applySchemaIfMissing returns false,
// markExistingMigrationsApplied is skipped, node-pg-migrate is a no-op
// when no new migrations are present.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runner as migrationRunner } from "node-pg-migrate";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const defaultSchemaPath = resolve(repoRoot, "src/server/db/schema.sql");
const defaultMigrationsDir = resolve(repoRoot, "src/server/db/migrations");

export async function applySchemaIfMissing(pool, schemaPath = defaultSchemaPath) {
  const probe = await pool.query("SELECT to_regclass('public.users') AS t");
  if (probe.rows[0].t !== null) {
    console.log("bootstrap: schema already present — skipping schema.sql");
    return false;
  }
  console.log("bootstrap: users table missing — loading schema.sql");
  const schema = readFileSync(schemaPath, "utf8");
  await pool.query(schema);
  console.log("bootstrap: schema.sql applied");
  return true;
}

export async function markExistingMigrationsApplied(pool, migrationsDir = defaultMigrationsDir) {
  // Ensure the tracking table exists with the shape node-pg-migrate uses.
  // Harmless on repeat deploys (CREATE ... IF NOT EXISTS).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS pgmigrations (
       id SERIAL PRIMARY KEY,
       name VARCHAR(255) NOT NULL,
       run_on TIMESTAMP NOT NULL
     )`,
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let inserted = 0;
  for (const file of files) {
    const name = file.replace(/\.sql$/, "");
    // Explicit cast because pgmigrations.name is VARCHAR(255) — without it
    // Postgres sees $1 used as both text (INSERT target) and varchar (WHERE
    // comparison) and refuses to deduce a consistent type.
    const result = await pool.query(
      `INSERT INTO pgmigrations (name, run_on)
       SELECT $1::varchar, NOW()
       WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = $1::varchar)`,
      [name],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

/**
 * Orchestration extracted so tests can inject mocks for the three phases
 * and verify the freshness gate (only mark migrations as applied when the
 * schema was just loaded).
 */
export async function bootstrap({
  applySchema,
  markExisting,
  runMigrations,
  log = console.log,
}) {
  const freshSchema = await applySchema();
  if (freshSchema) {
    const marked = await markExisting();
    if (marked > 0) {
      log(`bootstrap: marked ${marked} migration(s) as pre-applied`);
    }
  } else {
    log(
      "bootstrap: existing DB — skipping mark-as-applied, node-pg-migrate will run any pending migrations",
    );
  }

  log("running node-pg-migrate up (for any migrations added after the baseline)");
  await runMigrations();
  log("migrations complete");

  return { freshSchema };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await bootstrap({
      applySchema: () => applySchemaIfMissing(pool),
      markExisting: () => markExistingMigrationsApplied(pool),
      runMigrations: () =>
        migrationRunner({
          databaseUrl,
          dir: defaultMigrationsDir,
          migrationsTable: "pgmigrations",
          direction: "up",
          count: Number.POSITIVE_INFINITY,
          verbose: true,
        }),
    });
  } finally {
    await pool.end();
  }
}

const isMain =
  (typeof import.meta !== "undefined" && import.meta.main) ||
  process.argv[1]?.endsWith("bootstrap-and-migrate.mjs");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
