#!/usr/bin/env node
// Release-time DB setup for Fly / any fresh-cluster deploy.
//
// Fly Postgres starts empty — it doesn't run docker-entrypoint-initdb.d
// the way the local docker-compose does, so src/server/db/schema.sql
// never gets applied automatically. This script handles both first-time
// bootstrap AND ongoing deploys:
//
//   1. If `users` table is missing → apply schema.sql once.
//   2. Ensure every existing migration is recorded in pgmigrations as
//      already applied. Per CLAUDE.md policy, schema.sql is kept in
//      sync with the current target state, so every migration file is
//      already reflected there. Running them again would collide on
//      constraints/indexes/columns that schema.sql created with
//      implicit names (e.g. inline CHECK → auto-named notes_style_check,
//      which migration 3 tries to ADD CONSTRAINT).
//   3. Run node-pg-migrate up — picks up any genuinely new migrations
//      added after the current baseline.
//
// Idempotent; safe to run on every deploy. The "mark as applied" step
// also rescues a partial pgmigrations state from a prior failed deploy.

import { readFileSync, readdirSync } from "node:fs";
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

async function applySchemaIfMissing(pool) {
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

async function markExistingMigrationsApplied(pool) {
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

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await applySchemaIfMissing(pool);
    const marked = await markExistingMigrationsApplied(pool);
    if (marked > 0) {
      console.log(
        `bootstrap: marked ${marked} migration(s) as pre-applied (already reflected in schema.sql)`,
      );
    }
  } finally {
    await pool.end();
  }

  console.log("running node-pg-migrate up (for any migrations added after the baseline)");
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
