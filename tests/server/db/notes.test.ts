import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as noteQueries from "../../../src/server/db/queries/notes";
import * as userQueries from "../../../src/server/db/queries/users";
import type { JarAppearance, JarConfig } from "../../../src/shared/types";

let pool: pg.Pool;
let testUserId: string;
let testJarId: string;

const TEST_APPEARANCE: JarAppearance = {
  label: "Test Jar",
};

const TEST_CONFIG: JarConfig = {
  noteVisibility: "open",
  sealedRevealCount: 1,
  showAuthors: false,
};

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });
  const user = await userQueries.createUser(pool, {
    displayName: "Note Test User",
    email: "test-notes@example.com",
  });
  testUserId = user.id;

  const jar = await jarQueries.createJar(pool, {
    ownerId: testUserId,
    name: "Note Test Jar",
    appearance: TEST_APPEARANCE,
    config: TEST_CONFIG,
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

describe("note queries", () => {
  it("creates a note in a jar", async () => {
    const note = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Go to the park",
      style: "sticky",
      authorId: testUserId,
    });

    expect(note.id).toBeDefined();
    expect(note.jarId).toBe(testJarId);
    expect(note.text).toBe("Go to the park");
    expect(note.state).toBe("in_jar");
    expect(note.style).toBe("sticky");
    expect(note.url).toBeUndefined();
  });

  it("creates a note with a URL", async () => {
    const note = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Check this place",
      url: "https://example.com",
      style: "sticky",
      authorId: testUserId,
    });

    expect(note.url).toBe("https://example.com");
  });

  it("lists notes by jar", async () => {
    await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Note 1",
      style: "sticky",
      authorId: testUserId,
    });
    await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Note 2",
      style: "sticky",
      authorId: testUserId,
    });

    const notes = await noteQueries.listNotesByJar(pool, testJarId);
    expect(notes).toHaveLength(2);
  });

  it("lists notes filtered by state", async () => {
    const note = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Will be pulled",
      style: "sticky",
      authorId: testUserId,
    });
    await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Stays in jar",
      style: "sticky",
      authorId: testUserId,
    });
    await noteQueries.updateNoteState(pool, note.id, "pulled");

    const inJar = await noteQueries.listNotesByJar(pool, testJarId, "in_jar");
    expect(inJar).toHaveLength(1);
    expect(inJar[0].text).toBe("Stays in jar");

    const pulled = await noteQueries.listNotesByJar(pool, testJarId, "pulled");
    expect(pulled).toHaveLength(1);
    expect(pulled[0].text).toBe("Will be pulled");
  });

  it("updates note state", async () => {
    const note = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "State test",
      style: "sticky",
      authorId: testUserId,
    });

    const updated = await noteQueries.updateNoteState(pool, note.id, "pulled");
    expect(updated?.state).toBe("pulled");
  });

  it("updates note text", async () => {
    const note = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Original text",
      style: "sticky",
      authorId: testUserId,
    });

    const updated = await noteQueries.updateNote(pool, note.id, { text: "Edited text" });
    expect(updated?.text).toBe("Edited text");
  });

  it("pulls a random note from the jar", async () => {
    await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Random candidate 1",
      style: "sticky",
      authorId: testUserId,
    });
    await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Random candidate 2",
      style: "sticky",
      authorId: testUserId,
    });

    const pulled = await noteQueries.pullRandomNote(pool, testJarId);
    expect(pulled).not.toBeNull();
    expect(pulled?.state).toBe("pulled");
    expect(["Random candidate 1", "Random candidate 2"]).toContain(pulled?.text);
  });

  it("returns null when pulling from an empty jar", async () => {
    const pulled = await noteQueries.pullRandomNote(pool, testJarId);
    expect(pulled).toBeNull();
  });

  it("deletes a note", async () => {
    const note = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Delete me",
      style: "sticky",
      authorId: testUserId,
    });

    const deleted = await noteQueries.deleteNote(pool, note.id);
    expect(deleted).toBe(true);

    const notes = await noteQueries.listNotesByJar(pool, testJarId);
    expect(notes).toHaveLength(0);
  });
});
