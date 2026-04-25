#!/usr/bin/env node
/**
 * Walks source directories and reports source files that lack a mirrored
 * unit test. Mirroring rule: `src/<path>/Foo.tsx` is covered by any of:
 *   tests/<path>/Foo.test.tsx
 *   tests/<path>/Foo.test.ts
 *   tests/<path>/Foo.<descriptor>.test.tsx
 *   tests/<path>/Foo.<descriptor>.test.ts
 *
 * Usage:
 *   node scripts/find-missing-tests.mjs                       # scans all DEFAULT_PAIRS
 *   node scripts/find-missing-tests.mjs <srcDir> <testDir>    # scans one custom pair
 *
 * Exits 1 if any source files are missing tests (CI-friendly).
 *
 * Only directories that follow strict 1:1 filename mirroring are scanned by
 * default — server-side tests group across files (e.g. `routes/jarsAndNotes.test.ts`
 * covers multiple route files), so name-based detection produces false positives there.
 */

export const DEFAULT_PAIRS = [
  { src: "src/client/components", tests: "tests/client/components" },
  { src: "src/client/hooks", tests: "tests/client/hooks" },
  { src: "src/client/lib", tests: "tests/client/lib" },
  { src: "src/client/stores", tests: "tests/client/stores" },
];

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const SOURCE_EXTS = new Set([".ts", ".tsx"]);

export function isTestFile(name) {
  return /\.test\.(ts|tsx)$/.test(name);
}

export function isSourceCandidate(name) {
  if (isTestFile(name)) return false;
  if (name.endsWith(".d.ts")) return false;
  return SOURCE_EXTS.has(extname(name));
}

export function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (st.isFile() && isSourceCandidate(entry)) {
      out.push(full);
    }
  }
  return out;
}

export function hasMirroredTest(srcFile, srcRoot, testRoot) {
  const rel = relative(srcRoot, srcFile);
  const dir = dirname(rel);
  const ext = extname(rel);
  const stem = basename(rel, ext);
  const mirroredDir = join(testRoot, dir);
  if (!existsSync(mirroredDir)) return false;
  const prefix = `${stem}.`;
  for (const entry of readdirSync(mirroredDir)) {
    if (!isTestFile(entry)) continue;
    if (entry === `${stem}.test.ts` || entry === `${stem}.test.tsx`) return true;
    if (entry.startsWith(prefix) && /\.test\.(ts|tsx)$/.test(entry)) return true;
  }
  return false;
}

export function findMissing(srcRoot, testRoot) {
  if (!existsSync(srcRoot)) {
    throw new Error(`Source directory not found: ${srcRoot}`);
  }
  return walk(srcRoot)
    .filter((f) => !hasMirroredTest(f, srcRoot, testRoot))
    .sort();
}

function scanPair(srcRoot, testRoot) {
  const missing = findMissing(srcRoot, testRoot);
  const srcRel = relative(process.cwd(), srcRoot);
  const testRel = relative(process.cwd(), testRoot);
  if (missing.length === 0) {
    console.log(`✓ ${srcRel} — all source files have a mirrored test.`);
    return 0;
  }
  console.log(`✗ ${srcRel} — missing ${missing.length} test(s) under ${testRel}:`);
  for (const file of missing) {
    console.log(`    ${relative(process.cwd(), file)}`);
  }
  return missing.length;
}

function main() {
  const args = process.argv.slice(2);
  const pairs =
    args.length === 2
      ? [{ src: args[0], tests: args[1] }]
      : DEFAULT_PAIRS;

  let totalMissing = 0;
  for (const { src, tests } of pairs) {
    totalMissing += scanPair(resolve(src), resolve(tests));
  }

  if (totalMissing > 0) {
    console.log(`\n${totalMissing} source file(s) missing a unit test.`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
