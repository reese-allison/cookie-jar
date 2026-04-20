import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as roomQueries from "../../../src/server/db/queries/rooms";
import * as userQueries from "../../../src/server/db/queries/users";
import type { JarAppearance, JarConfig } from "../../../src/shared/types";

let pool: pg.Pool;
let testUserId: string;
let otherUserId: string;

const APPEARANCE: JarAppearance = { label: "T" };
const CONFIG: JarConfig = {
  noteVisibility: "open",
  pullVisibility: "shared",
  sealedRevealCount: 1,
  showAuthors: false,
  showPulledBy: false,
};

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });
  const u1 = await userQueries.createUser(pool, {
    displayName: "Owned Jars User",
    email: "test-owned-jars@example.com",
  });
  testUserId = u1.id;
  const u2 = await userQueries.createUser(pool, {
    displayName: "Other User",
    email: "test-owned-jars-other@example.com",
  });
  otherUserId = u2.id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM jars WHERE owner_id IN ($1, $2)", [testUserId, otherUserId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [testUserId, otherUserId]);
  await pool.end();
});

describe("listOwnedJarsWithRooms", () => {
  it("returns an empty list when the user owns no jars", async () => {
    const result = await jarQueries.listOwnedJarsWithRooms(pool, testUserId);
    expect(result).toEqual([]);
  });

  it("returns owned jars with no rooms when none exist", async () => {
    const jar = await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "Quiet Jar",
      appearance: APPEARANCE,
      config: CONFIG,
    });

    const result = await jarQueries.listOwnedJarsWithRooms(pool, testUserId);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(jar.id);
    expect(result[0].name).toBe("Quiet Jar");
    expect(result[0].activeRooms).toEqual([]);
  });

  it("includes open and locked rooms but excludes closed rooms", async () => {
    const jar = await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "Busy Jar",
      appearance: APPEARANCE,
      config: CONFIG,
    });
    const openRoom = await roomQueries.createRoom(pool, { jarId: jar.id });
    const lockedRoom = await roomQueries.createRoom(pool, { jarId: jar.id });
    await roomQueries.updateRoomState(pool, lockedRoom.id, "locked");
    const closedRoom = await roomQueries.createRoom(pool, { jarId: jar.id });
    await roomQueries.updateRoomState(pool, closedRoom.id, "closed");

    const result = await jarQueries.listOwnedJarsWithRooms(pool, testUserId);
    expect(result).toHaveLength(1);
    const codes = result[0].activeRooms.map((r) => r.code).sort();
    expect(codes).toEqual([openRoom.code, lockedRoom.code].sort());
  });

  it("does not return jars owned by other users", async () => {
    await jarQueries.createJar(pool, {
      ownerId: otherUserId,
      name: "Not Mine",
      appearance: APPEARANCE,
      config: CONFIG,
    });

    const result = await jarQueries.listOwnedJarsWithRooms(pool, testUserId);
    expect(result).toEqual([]);
  });

  it("orders jars newest first", async () => {
    const older = await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "Older",
      appearance: APPEARANCE,
      config: CONFIG,
    });
    // Force a later created_at so ordering is deterministic regardless of clock resolution.
    await pool.query("UPDATE jars SET created_at = now() + interval '1 second' WHERE id != $1", [
      older.id,
    ]);
    await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "Newer",
      appearance: APPEARANCE,
      config: CONFIG,
    });

    const result = await jarQueries.listOwnedJarsWithRooms(pool, testUserId);
    expect(result.map((j) => j.name)).toEqual(["Newer", "Older"]);
  });
});
