import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script has no .d.ts companion; signature is asserted by tests.
import { findStrayMarkers } from "../../scripts/check-migration-markers.mjs";

interface StrayMarker {
  file: string;
  direction: "up" | "down";
  lines: number[];
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "migration-markers-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function migration(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("findStrayMarkers", () => {
  it("passes a normal migration with exactly one Up and one Down marker", () => {
    migration(
      "ok.sql",
      [
        "-- Up Migration",
        "ALTER TABLE foo ADD COLUMN bar TEXT;",
        "",
        "-- Down Migration",
        "ALTER TABLE foo DROP COLUMN bar;",
      ].join("\n"),
    );
    expect(findStrayMarkers(dir)).toEqual([]);
  });

  it("flags the file when a comment matches the down-marker regex inside the Up section", () => {
    // This is the exact bug that silently no-op'd 1778717000000_drop_rooms_code:
    // a comment line starting "-- down migration ..." matches node-pg-migrate's
    // boundary regex; the parser uses the first match per direction, so it
    // treats the comment line as the Down boundary and the real `-- Down
    // Migration` below is moot.
    const path = migration(
      "trap.sql",
      [
        "-- Up Migration",
        "-- This is destructive — the",
        "-- down migration restores only the shape",
        "ALTER TABLE foo DROP COLUMN bar;",
        "",
        "-- Down Migration",
        "ALTER TABLE foo ADD COLUMN bar TEXT;",
      ].join("\n"),
    );
    const hits = findStrayMarkers(dir);
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe(path);
    expect(hits[0].direction).toBe("down");
    // Both matches are reported so the operator can see which one was the
    // stray (here line 3) vs the legitimate marker (line 6).
    expect(hits[0].lines).toEqual([3, 6]);
  });

  it("flags an up-direction analog (two literal '-- Up Migration' lines)", () => {
    migration(
      "trap-up.sql",
      [
        "-- Up Migration",
        "-- Up Migration applies this change forward",
        "ALTER TABLE foo ADD COLUMN bar TEXT;",
        "-- Down Migration",
      ].join("\n"),
    );
    const hits = findStrayMarkers(dir);
    expect(hits).toHaveLength(1);
    expect(hits[0].direction).toBe("up");
    expect(hits[0].lines).toEqual([1, 2]);
  });

  it("tolerates the loose marker variants the parser also accepts", () => {
    // `[\s-]*` between -- and the keyword means these are all legitimate
    // single-instance markers in the parser's eyes.
    migration(
      "variant.sql",
      [
        "----- Up Migration",
        "ALTER TABLE foo ADD COLUMN bar TEXT;",
        "-- - Down Migration",
        "ALTER TABLE foo DROP COLUMN bar;",
      ].join("\n"),
    );
    expect(findStrayMarkers(dir)).toEqual([]);
  });

  it("scans every .sql file in the directory and returns one entry per offending file/direction", () => {
    migration(
      "ok.sql",
      ["-- Up Migration", "SELECT 1;", "-- Down Migration", "SELECT 2;"].join("\n"),
    );
    migration(
      "bad-down.sql",
      [
        "-- Up Migration",
        "-- down migration mentions the keyword",
        "SELECT 1;",
        "-- Down Migration",
        "SELECT 2;",
      ].join("\n"),
    );
    migration(
      "bad-up.sql",
      [
        "-- Up Migration",
        "-- Up Migration: second occurrence",
        "SELECT 1;",
        "-- Down Migration",
        "SELECT 2;",
      ].join("\n"),
    );
    const hits: StrayMarker[] = findStrayMarkers(dir);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.direction).sort()).toEqual(["down", "up"]);
  });

  it("checked migrations: the project's own migration directory is clean", () => {
    // Self-check against the real source — guards future regressions.
    const realHits = findStrayMarkers("src/server/db/migrations");
    expect(realHits).toEqual([]);
  });
});
