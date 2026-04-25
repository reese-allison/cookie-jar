import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as noteQueries from "../../../src/server/db/queries/notes";
import * as userQueries from "../../../src/server/db/queries/users";
import { makeJarAppearance, makeJarConfig } from "../../helpers/fixtures";

let pool: pg.Pool;
let testUserId: string;
let testJarId: string;

const TEST_APPEARANCE = makeJarAppearance();
const TEST_CONFIG = makeJarConfig();

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

  describe("bulkTransitionPulled", () => {
    it("returns every pulled note to in_jar and clears puller identity", async () => {
      // Seed three notes and pull them all so they're on the table.
      for (const text of ["A", "B", "C"]) {
        await noteQueries.createNote(pool, { jarId: testJarId, text, style: "sticky" });
      }
      for (let i = 0; i < 3; i++) {
        await noteQueries.pullRandomNote(pool, testJarId, "someone", testUserId);
      }
      const ids = await noteQueries.bulkTransitionPulled(pool, testJarId, "in_jar");
      expect(ids).toHaveLength(3);
      const rows = await noteQueries.listNotesByJar(pool, testJarId, "in_jar");
      expect(rows).toHaveLength(3);
      expect(rows.every((n) => !n.pulledBy && !n.pulledByUserId)).toBe(true);
    });

    it("discards every pulled note without touching in_jar ones", async () => {
      await noteQueries.createNote(pool, { jarId: testJarId, text: "pulled-me", style: "sticky" });
      await noteQueries.createNote(pool, {
        jarId: testJarId,
        text: "still-in-jar",
        style: "sticky",
      });
      await noteQueries.pullRandomNote(pool, testJarId, "anon");
      const ids = await noteQueries.bulkTransitionPulled(pool, testJarId, "discarded");
      expect(ids).toHaveLength(1);
      expect(await noteQueries.countNotesByState(pool, testJarId, "in_jar")).toBe(1);
      expect(await noteQueries.countNotesByState(pool, testJarId, "discarded")).toBe(1);
    });

    it("is a no-op when nothing is pulled", async () => {
      const ids = await noteQueries.bulkTransitionPulled(pool, testJarId, "in_jar");
      expect(ids).toHaveLength(0);
    });
  });

  describe("transitionPulledNotesFor", () => {
    it("flips only the given user's pulls back to in_jar", async () => {
      const other = await userQueries.createUser(pool, {
        displayName: "Other User",
        email: "other-notes@example.com",
      });
      for (const text of ["mine", "theirs"]) {
        await noteQueries.createNote(pool, { jarId: testJarId, text, style: "sticky" });
      }
      await noteQueries.pullRandomNote(pool, testJarId, "Me", testUserId);
      await noteQueries.pullRandomNote(pool, testJarId, "Them", other.id);
      const moved = await noteQueries.transitionPulledNotesFor(pool, testJarId, "in_jar", {
        userId: testUserId,
        displayName: "Me",
      });
      expect(moved).toHaveLength(1);
      expect(await noteQueries.countNotesByState(pool, testJarId, "pulled")).toBe(1);
      await pool.query("DELETE FROM users WHERE id = $1", [other.id]);
    });

    it("falls back to display-name match when the puller had no user id", async () => {
      await noteQueries.createNote(pool, { jarId: testJarId, text: "anon-pull", style: "sticky" });
      // Anon pull — no userId.
      await noteQueries.pullRandomNote(pool, testJarId, "GuestName");
      const moved = await noteQueries.transitionPulledNotesFor(pool, testJarId, "in_jar", {
        userId: null,
        displayName: "GuestName",
      });
      expect(moved).toHaveLength(1);
    });
  });

  describe("createNoteIfUnderCap", () => {
    it("inserts when the jar has room", async () => {
      const note = await noteQueries.createNoteIfUnderCap(
        pool,
        { jarId: testJarId, text: "under cap", style: "sticky" },
        3,
      );
      expect(note).not.toBeNull();
      expect(note?.text).toBe("under cap");
    });

    it("returns null when at the cap", async () => {
      await noteQueries.createNote(pool, { jarId: testJarId, text: "a", style: "sticky" });
      await noteQueries.createNote(pool, { jarId: testJarId, text: "b", style: "sticky" });
      const note = await noteQueries.createNoteIfUnderCap(
        pool,
        { jarId: testJarId, text: "c", style: "sticky" },
        2,
      );
      expect(note).toBeNull();
      expect(await noteQueries.countNotesByState(pool, testJarId, "in_jar")).toBe(2);
    });

    it("serializes concurrent inserts — cannot overflow the cap", async () => {
      // Fire 10 concurrent inserts with a cap of 5. Without the advisory lock,
      // all 10 race reads of count=0 and all 10 insert. With the lock, exactly
      // 5 succeed and 5 return null.
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          noteQueries.createNoteIfUnderCap(
            pool,
            { jarId: testJarId, text: `race-${i}`, style: "sticky" },
            5,
          ),
        ),
      );
      const inserted = results.filter((r: unknown) => r !== null).length;
      expect(inserted).toBe(5);
      expect(await noteQueries.countNotesByState(pool, testJarId, "in_jar")).toBe(5);
    });
  });

  describe("url protocol CHECK", () => {
    // The protocol guard is enforced by either:
    //   - schema.sql's inline CHECK on `notes.url` (auto-named `notes_url_check`)
    //     when a fresh DB is bootstrapped from schema.sql, or
    //   - migration 1776750000000's named `notes_url_protocol_check` constraint
    //     when an older DB is upgraded migration-by-migration.
    // Either name is correct — the test asserts the *behavior* (DB rejects it)
    // not the specific constraint name.
    const URL_CHECK_NAME = /notes_url(?:_protocol)?_check/;

    it("rejects a javascript: URL at the DB layer", async () => {
      await expect(
        pool.query("INSERT INTO notes (jar_id, text, url, style) VALUES ($1, $2, $3, $4)", [
          testJarId,
          "oops",
          "javascript:alert(1)",
          "sticky",
        ]),
      ).rejects.toThrow(URL_CHECK_NAME);
    });

    it("rejects a data: URL at the DB layer", async () => {
      await expect(
        pool.query("INSERT INTO notes (jar_id, text, url, style) VALUES ($1, $2, $3, $4)", [
          testJarId,
          "oops",
          "data:text/html,<script>alert(1)</script>",
          "sticky",
        ]),
      ).rejects.toThrow(URL_CHECK_NAME);
    });

    it("accepts http and https URLs", async () => {
      const http = await noteQueries.createNote(pool, {
        jarId: testJarId,
        text: "link",
        url: "http://example.com",
        style: "sticky",
      });
      expect(http.url).toBe("http://example.com");
      const https = await noteQueries.createNote(pool, {
        jarId: testJarId,
        text: "secure-link",
        url: "https://example.com/path?q=1",
        style: "sticky",
      });
      expect(https.url).toBe("https://example.com/path?q=1");
    });
  });
});
