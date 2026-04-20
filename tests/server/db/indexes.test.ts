import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPoolConfig } from "../../../src/server/db/pool";

// Verifies critical indexes are present. If these go missing, cascade deletes
// and history queries degrade badly at scale.
const REQUIRED_INDEXES = [
  { table: "notes", column: "author_id" },
  { table: "pull_history", column: "note_id" },
  { table: "pull_history", column: "room_id" },
  { table: "notes", column: "jar_id" },
  { table: "jars", column: "owner_id" },
  { table: "rooms", column: "code" },
];

let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool(buildPoolConfig());
});

afterAll(async () => {
  await pool.end();
});

describe("critical DB indexes", () => {
  for (const { table, column } of REQUIRED_INDEXES) {
    it(`has an index covering ${table}.${column}`, async () => {
      const { rows } = await pool.query(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = $1 AND indexdef ILIKE $2`,
        [table, `%(${column})%`],
      );
      expect(rows.length, `no index found on ${table}.${column}`).toBeGreaterThan(0);
    });
  }
});
