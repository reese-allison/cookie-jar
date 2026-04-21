import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as roomQueries from "../../../src/server/db/queries/rooms";
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
    displayName: "Room Test User",
    email: "test-rooms@example.com",
  });
  testUserId = user.id;

  const jar = await jarQueries.createJar(pool, {
    ownerId: testUserId,
    name: "Room Test Jar",
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
  await pool.query("DELETE FROM rooms WHERE jar_id = $1", [testJarId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM jars WHERE id = $1", [testJarId]);
  await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  await pool.end();
});

describe("room queries", () => {
  it("creates a room with a generated code", async () => {
    const room = await roomQueries.createRoom(pool, { jarId: testJarId });

    expect(room.id).toBeDefined();
    expect(room.code).toHaveLength(6);
    expect(room.jarId).toBe(testJarId);
    expect(room.state).toBe("open");
    expect(room.maxParticipants).toBe(20);
    expect(room.maxViewers).toBe(50);
  });

  it("creates a room with custom limits", async () => {
    const room = await roomQueries.createRoom(pool, {
      jarId: testJarId,
      maxParticipants: 8,
      maxViewers: 15,
      idleTimeoutMinutes: 60,
    });

    expect(room.maxParticipants).toBe(8);
    expect(room.maxViewers).toBe(15);
    expect(room.idleTimeoutMinutes).toBe(60);
  });

  it("finds a room by code", async () => {
    const created = await roomQueries.createRoom(pool, { jarId: testJarId });
    const found = await roomQueries.getRoomByCode(pool, created.code);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });

  it("returns null for a non-existent code", async () => {
    const found = await roomQueries.getRoomByCode(pool, "ZZZZZZ");
    expect(found).toBeNull();
  });

  it("updates room state to locked", async () => {
    const room = await roomQueries.createRoom(pool, { jarId: testJarId });
    const updated = await roomQueries.updateRoomState(pool, room.id, "locked");

    expect(updated?.state).toBe("locked");
  });

  it("updates room state to closed and sets closed_at", async () => {
    const room = await roomQueries.createRoom(pool, { jarId: testJarId });
    const updated = await roomQueries.updateRoomState(pool, room.id, "closed");

    expect(updated?.state).toBe("closed");
    expect(updated?.closedAt).toBeDefined();
  });

  it("generates unique codes across multiple rooms", async () => {
    // Each room needs its own jar — the partial unique index on
    // rooms(jar_id) WHERE state != 'closed' caps active rooms at one per
    // jar. We're testing code-generator distinctness here, not multi-room
    // support per jar.
    const ownerRow = await pool.query("SELECT owner_id FROM jars WHERE id = $1", [testJarId]);
    const ownerId = ownerRow.rows[0].owner_id as string;
    const jarIds = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const j = await pool.query(
          "INSERT INTO jars (owner_id, name) VALUES ($1, $2) RETURNING id",
          [ownerId, `code-uniqueness-${i}`],
        );
        return j.rows[0].id as string;
      }),
    );
    try {
      const rooms = await Promise.all(
        jarIds.map((jarId) => roomQueries.createRoom(pool, { jarId })),
      );
      const codes = new Set(rooms.map((r) => r.code));
      expect(codes.size).toBe(10);
    } finally {
      await pool.query("DELETE FROM jars WHERE id = ANY($1::uuid[])", [jarIds]);
    }
  });
});
