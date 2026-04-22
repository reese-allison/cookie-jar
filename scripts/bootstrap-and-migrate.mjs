#!/usr/bin/env node
// Release-time DB setup for Fly / any fresh-cluster deploy.
//
// Fly Postgres starts empty — it doesn't run docker-entrypoint-initdb.d the
// way the local docker-compose does, so src/server/db/schema.sql never gets
// applied automatically. On first deploy, `users`/`jars`/etc. don't exist
// and the first incremental migration fails with "relation does not exist".
//
// This script:
//   1. Connects to DATABASE_URL.
//   2. Checks if the `users` table exists (our "is the schema loaded?" probe).
//   3. If missing, runs schema.sql once to create the full baseline.
//   4. Runs node-pg-migrate up.
//
// Safe to run on every deploy. Step 2 short-circuits after the first time.
// All 7 migration files use `... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
// so they're also idempotent against a fresh schema.sql-seeded database.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runner as migrationRunner } from "node-pg-migrate";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const schemaPath = resolve(repoRoot, "src/server/db/schema.sql");
const migrationsDir = resolve(repoRoot, "src/server/db/migrations");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const probe = await pool.query(
      "SELECT to_regclass('public.users') AS t",
    );
    const schemaPresent = probe.rows[0].t !== null;

    if (!schemaPresent) {
      console.log("bootstrap: users table missing — loading schema.sql");
      const schema = readFileSync(schemaPath, "utf8");
      await pool.query(schema);
      console.log("bootstrap: schema.sql applied");
    } else {
      console.log("bootstrap: schema already present — skipping schema.sql");
    }
  } finally {
    await pool.end();
  }

  console.log("running node-pg-migrate up");
  await migrationRunner({
    databaseUrl,
    dir: migrationsDir,
    migrationsTable: "pgmigrations",
    direction: "up",
    count: Number.POSITIVE_INFINITY,
    verbose: true,
  });
  console.log("migrations complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
