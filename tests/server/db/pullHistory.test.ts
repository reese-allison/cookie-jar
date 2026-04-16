import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as noteQueries from "../../../src/server/db/queries/notes";
import * as pullHistoryQueries from "../../../src/server/db/queries/pullHistory";
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
    displayName: "History Test User",
    email: "test-history@example.com",
  });
  testUserId = user.id;

  const jar = await jarQueries.createJar(pool, {
    ownerId: testUserId,
    name: "History Test Jar",
    appearance: {},
    config: {
      noteVisibility: "open",
      pullVisibility: "shared",
      sealedRevealCount: 1,
      showAuthors: false,
      showPulledBy: false,
    },
  });
  testJarId = jar.id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM pull_history WHERE jar_id = $1", [testJarId]);
  await pool.query("DELETE FROM notes WHERE jar_id = $1", [testJarId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM jars WHERE id = $1", [testJarId]);
  await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  await pool.end();
});

describe("pull history queries", () => {
  it("records a pull and retrieves history", async () => {
    const note = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Historic note",
      style: "sticky",
    });

    await pullHistoryQueries.recordPull(pool, {
      jarId: testJarId,
      noteId: note.id,
      pulledBy: "Alice",
    });

    const history = await pullHistoryQueries.getHistory(pool, testJarId);
    expect(history).toHaveLength(1);
    expect(history[0].noteText).toBe("Historic note");
    expect(history[0].pulledBy).toBe("Alice");
    expect(history[0].pulledAt).toBeDefined();
  });

  it("returns history in reverse chronological order", async () => {
    const note1 = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "First pull",
      style: "sticky",
    });
    const note2 = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Second pull",
      style: "sticky",
    });

    await pullHistoryQueries.recordPull(pool, {
      jarId: testJarId,
      noteId: note1.id,
      pulledBy: "Alice",
    });
    await pullHistoryQueries.recordPull(pool, {
      jarId: testJarId,
      noteId: note2.id,
      pulledBy: "Bob",
    });

    const history = await pullHistoryQueries.getHistory(pool, testJarId);
    expect(history).toHaveLength(2);
    expect(history[0].noteText).toBe("Second pull");
    expect(history[1].noteText).toBe("First pull");
  });

  it("clears history for a jar", async () => {
    const note = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Will be cleared",
      style: "sticky",
    });

    await pullHistoryQueries.recordPull(pool, {
      jarId: testJarId,
      noteId: note.id,
      pulledBy: "Alice",
    });

    await pullHistoryQueries.clearHistory(pool, testJarId);
    const history = await pullHistoryQueries.getHistory(pool, testJarId);
    expect(history).toHaveLength(0);
  });
});
