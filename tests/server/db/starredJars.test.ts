import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as roomQueries from "../../../src/server/db/queries/rooms";
import * as starQueries from "../../../src/server/db/queries/starredJars";
import * as userQueries from "../../../src/server/db/queries/users";
import { makeJarAppearance, makeJarConfig } from "../../helpers/fixtures";

let pool: pg.Pool;
let ownerId: string;
let otherUserId: string;
let jarAId: string;
let jarBId: string;

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });
  const owner = await userQueries.createUser(pool, {
    displayName: "Owner",
    email: "star-owner@example.com",
  });
  const other = await userQueries.createUser(pool, {
    displayName: "Starrer",
    email: "star-other@example.com",
  });
  ownerId = owner.id;
  otherUserId = other.id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM user_starred_jars WHERE user_id = $1", [otherUserId]);
  await pool.query("DELETE FROM jars WHERE owner_id = $1", [ownerId]);
  const jarA = await jarQueries.createJar(pool, {
    ownerId,
    name: "Jar A",
    appearance: makeJarAppearance(),
    config: makeJarConfig(),
  });
  const jarB = await jarQueries.createJar(pool, {
    ownerId,
    name: "Jar B",
    appearance: makeJarAppearance(),
    config: makeJarConfig(),
  });
  jarAId = jarA.id;
  jarBId = jarB.id;
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [ownerId, otherUserId]);
  await pool.end();
});

describe("starredJars queries", () => {
  it("starJar + isStarred round-trip", async () => {
    expect(await starQueries.isStarred(pool, otherUserId, jarAId)).toBe(false);
    await starQueries.starJar(pool, otherUserId, jarAId);
    expect(await starQueries.isStarred(pool, otherUserId, jarAId)).toBe(true);
  });

  it("starJar twice is idempotent (no duplicate-key error)", async () => {
    await starQueries.starJar(pool, otherUserId, jarAId);
    await starQueries.starJar(pool, otherUserId, jarAId);
    const ids = await starQueries.listStarredJarIds(pool, otherUserId);
    expect(ids).toEqual([jarAId]);
  });

  it("unstarJar removes the row", async () => {
    await starQueries.starJar(pool, otherUserId, jarAId);
    await starQueries.unstarJar(pool, otherUserId, jarAId);
    expect(await starQueries.isStarred(pool, otherUserId, jarAId)).toBe(false);
  });

  it("unstarJar is silent when not starred", async () => {
    await expect(starQueries.unstarJar(pool, otherUserId, jarAId)).resolves.toBeUndefined();
  });

  it("listStarredJarIds orders newest first", async () => {
    await starQueries.starJar(pool, otherUserId, jarAId);
    // Small wait to ensure distinct starred_at timestamps
    await new Promise((r) => setTimeout(r, 10));
    await starQueries.starJar(pool, otherUserId, jarBId);
    const ids = await starQueries.listStarredJarIds(pool, otherUserId);
    expect(ids).toEqual([jarBId, jarAId]);
  });

  it("star is dropped when the jar is deleted (FK cascade)", async () => {
    await starQueries.starJar(pool, otherUserId, jarAId);
    await pool.query("DELETE FROM jars WHERE id = $1", [jarAId]);
    expect(await starQueries.isStarred(pool, otherUserId, jarAId)).toBe(false);
  });
});

describe("listStarredJarsWithRooms", () => {
  it("returns the user's starred jars with empty activeRooms when none are open", async () => {
    await starQueries.starJar(pool, otherUserId, jarAId);
    const rows = await starQueries.listStarredJarsWithRooms(pool, otherUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(jarAId);
    expect(rows[0].activeRooms).toEqual([]);
  });

  it("returns only non-closed rooms as activeRooms, newest first", async () => {
    await starQueries.starJar(pool, otherUserId, jarAId);
    const oldRoom = await roomQueries.createRoom(pool, { jarId: jarAId });
    await pool.query("UPDATE rooms SET state = 'closed' WHERE id = $1", [oldRoom.id]);
    await new Promise((r) => setTimeout(r, 5));
    const newRoom = await roomQueries.createRoom(pool, { jarId: jarAId });
    const rows = await starQueries.listStarredJarsWithRooms(pool, otherUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].activeRooms.map((r) => r.code)).toEqual([newRoom.code]);
  });

  it("orders jars by starred_at desc across multiple stars", async () => {
    await starQueries.starJar(pool, otherUserId, jarAId);
    await new Promise((r) => setTimeout(r, 10));
    await starQueries.starJar(pool, otherUserId, jarBId);
    const rows = await starQueries.listStarredJarsWithRooms(pool, otherUserId);
    expect(rows.map((j) => j.id)).toEqual([jarBId, jarAId]);
  });

  it("isolates by user — another user's stars are not returned", async () => {
    await starQueries.starJar(pool, otherUserId, jarAId);
    await starQueries.starJar(pool, ownerId, jarBId);
    const rows = await starQueries.listStarredJarsWithRooms(pool, otherUserId);
    expect(rows.map((j) => j.id)).toEqual([jarAId]);
  });

  it("returns an empty list when the user has starred nothing", async () => {
    const rows = await starQueries.listStarredJarsWithRooms(pool, otherUserId);
    expect(rows).toEqual([]);
  });
});
