import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as noteQueries from "../../../src/server/db/queries/notes";
import * as userQueries from "../../../src/server/db/queries/users";

let pool: pg.Pool;
let testUserId: string;
let testJarId: string;

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });
  const user = await userQueries.createUser(pool, {
    displayName: "Bulk Test User",
    email: "test-bulk@example.com",
  });
  testUserId = user.id;

  const jar = await jarQueries.createJar(pool, {
    ownerId: testUserId,
    name: "Bulk Test Jar",
  });
  testJarId = jar.id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM notes WHERE jar_id = $1", [testJarId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM jars WHERE id = $1", [testJarId]);
  await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  await pool.end();
});

describe("bulk import", () => {
  it("imports notes from a newline-separated list", async () => {
    const texts = ["First note", "Second note", "Third note"];
    await noteQueries.bulkCreateNotes(pool, testJarId, texts);

    const notes = await noteQueries.listNotesByJar(pool, testJarId);
    expect(notes).toHaveLength(3);
    expect(notes.map((n) => n.text).sort()).toEqual(texts.sort());
  });

  it("skips empty lines", async () => {
    const texts = ["Note one", "", "  ", "Note two"];
    await noteQueries.bulkCreateNotes(pool, testJarId, texts);

    const notes = await noteQueries.listNotesByJar(pool, testJarId);
    expect(notes).toHaveLength(2);
  });
});

describe("bulk export", () => {
  it("exports notes as objects", async () => {
    await noteQueries.createNote(pool, { jarId: testJarId, text: "Export me", style: "sticky" });
    await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Me too",
      url: "https://example.com",
      style: "sticky",
    });

    const notes = await noteQueries.listNotesByJar(pool, testJarId);
    expect(notes).toHaveLength(2);
    expect(notes[0].text).toBeDefined();
    expect(notes[1].url).toBe("https://example.com");
  });
});
