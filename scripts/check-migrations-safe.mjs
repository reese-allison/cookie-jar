#!/usr/bin/env node
/**
 * Pre-deploy guard: refuses to deploy if pending migrations contain
 * destructive SQL unless ALLOW_DESTRUCTIVE_MIGRATION=1 is set.
 *
 * "Pending" = migration files newer than the last applied entry in the
 * `pgmigrations` table. Run this as a step in CI before `db:migrate:up`.
 *
 * Usage:
 *   node scripts/check-migrations-safe.mjs
 *   ALLOW_DESTRUCTIVE_MIGRATION=1 node scripts/check-migrations-safe.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? "src/server/db/migrations";

// Patterns that are almost always destructive or block-taking. Expand→contract
// pattern: the "contract" migration (the destructive one) must be deployed in
// a separate release from the feature that depends on the new shape, so the
// old code paths no longer need the dropped column/table by the time it runs.
const DESTRUCTIVE_PATTERNS = [
  /DROP\s+TABLE/i,
  /DROP\s+COLUMN/i,
  /DROP\s+INDEX(?!\s+CONCURRENTLY)/i,
  /ALTER\s+TABLE\s+\w+\s+DROP/i,
  /ALTER\s+TABLE\s+\w+\s+ALTER\s+COLUMN\s+\w+\s+TYPE/i,
  /TRUNCATE/i,
];

function upSection(sql) {
  const [upRaw] = sql.split(/--\s*Down Migration/i);
  return upRaw.replace(/--\s*Up Migration/i, "");
}

function findDestructive(filename, sql) {
  const up = upSection(sql);
  const hits = [];
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    const match = up.match(pattern);
    if (match) hits.push({ filename, pattern: pattern.source, snippet: match[0] });
  }
  return hits;
}

async function getApplied(pool) {
  try {
    const { rows } = await pool.query("SELECT name FROM pgmigrations ORDER BY run_on");
    return new Set(rows.map((r) => r.name));
  } catch (err) {
    // Table doesn't exist yet — first deploy. Every migration is "pending".
    if (err.code === "42P01") return new Set();
    throw err;
  }
}

async function main() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") || f.endsWith(".js") || f.endsWith(".ts"))
    .sort();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL must be set");
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString });
  let applied;
  try {
    applied = await getApplied(pool);
  } finally {
    await pool.end();
  }

  const pending = files.filter((f) => {
    const stem = f.replace(/\.(sql|js|ts)$/, "");
    return !applied.has(stem);
  });

  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  const destructive = [];
  for (const file of pending) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    destructive.push(...findDestructive(file, sql));
  }

  if (destructive.length === 0) {
    console.log(`${pending.length} pending migration(s), all expand-only. Safe to proceed.`);
    return;
  }

  console.error("Destructive SQL found in pending migrations:");
  for (const hit of destructive) {
    console.error(`  - ${hit.filename}: matched ${hit.pattern} → "${hit.snippet.slice(0, 80)}"`);
  }

  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION === "1") {
    console.error(
      "\nALLOW_DESTRUCTIVE_MIGRATION=1 set — proceeding. Make sure the app code no longer references the dropped columns/tables.",
    );
    return;
  }

  console.error(
    "\nRefusing to deploy. Follow expand→contract: ship the new shape first (expand), then a separate release drops the old (contract). Set ALLOW_DESTRUCTIVE_MIGRATION=1 once the previous release is fully rolled out.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
