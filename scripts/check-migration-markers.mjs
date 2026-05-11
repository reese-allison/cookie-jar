#!/usr/bin/env node
/**
 * Guards against a foot-gun in node-pg-migrate's .sql parser.
 *
 * The parser uses `^\s*--[\s-]*<direction>\s+migration` (case-insensitive)
 * to find the section markers in `.sql` migrations. It's loose — a comment
 * line that happens to read "-- down migration restores ..." matches the
 * down-marker regex and the parser silently chops the Up section short of
 * any real SQL. The migration gets recorded as applied while its body
 * never runs.
 *
 * This script scans every `.sql` migration and fails if the marker regex
 * matches more than once per direction in a single file. Each well-formed
 * migration has exactly one Up marker and exactly one Down marker; anything
 * else is a stray that will mis-parse.
 *
 * Wire it into CI before db:migrate:up so the pre-flight bounces a file
 * that would silently no-op in production.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIRECTIONS = ["up", "down"];

function markerRegex(direction) {
  // Mirrors node_modules/node-pg-migrate/dist/legacy/sqlMigration.js exactly.
  return new RegExp(`^\\s*--[\\s-]*${direction}\\s+migration`, "i");
}

/**
 * Returns an array of `{ file, direction, lines }` for every file that has
 * MORE than one match of the marker regex for a given direction. `lines`
 * contains every matching line number — useful for the user to see which
 * one was the stray. An empty result means every file is safe to parse.
 */
export function findStrayMarkers(migrationsDir) {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join(migrationsDir, f));

  const hits = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n");
    for (const direction of DIRECTIONS) {
      const regex = markerRegex(direction);
      const matchingLines = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) matchingLines.push(i + 1);
      }
      if (matchingLines.length > 1) {
        hits.push({ file, direction, lines: matchingLines });
      }
    }
  }
  return hits;
}

async function main() {
  const dir = process.env.MIGRATIONS_DIR ?? "src/server/db/migrations";
  const hits = findStrayMarkers(dir);
  if (hits.length === 0) {
    console.log(`✓ ${dir}: no stray migration markers.`);
    return;
  }
  console.error("Stray migration markers found — these will silently no-op:\n");
  for (const h of hits) {
    console.error(
      `  ${h.file}\n    ${h.direction}-marker regex matches ${h.lines.length} lines: ${h.lines.join(", ")}`,
    );
  }
  console.error(
    "\nnode-pg-migrate uses the first match per direction as the section boundary.\n" +
      "A comment like `-- down migration restores only the shape` matches the\n" +
      "down-marker regex and the parser chops the Up section short. Reword the\n" +
      "stray comment so it doesn't start with `up migration` / `down migration`.",
  );
  process.exit(1);
}

const isMain =
  (typeof import.meta !== "undefined" && import.meta.main) ||
  process.argv[1]?.endsWith("check-migration-markers.mjs");
if (isMain) {
  await main();
}
