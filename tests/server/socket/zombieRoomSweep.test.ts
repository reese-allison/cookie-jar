import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as roomQueries from "../../../src/server/db/queries/rooms";
import * as userQueries from "../../../src/server/db/queries/users";
import type { PresenceStore } from "../../../src/server/socket/presenceStore";
import { closeZombieRooms } from "../../../src/server/socket/zombieRoomSweep";
import { makeJarAppearance, makeJarConfig } from "../../helpers/fixtures";

let pool: pg.Pool;
let ownerId: string;
let jarA: string;
let jarB: string;
let jarC: string;

function fakePresence(populated: Record<string, number>): PresenceStore {
  return {
    memberCount: vi.fn(async (roomId: string) => populated[roomId] ?? 0),
    // Unused by the sweep — stub to satisfy the interface.
    addMember: vi.fn(),
    addMemberIfUnderCap: vi.fn(),
    removeMember: vi.fn(),
    getMember: vi.fn(),
    getMembers: vi.fn(),
    hasMember: vi.fn(),
    clearRoom: vi.fn(),
    reconcile: vi.fn(),
  } as unknown as PresenceStore;
}

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });
  const u = await userQueries.createUser(pool, {
    displayName: "Zombie Owner",
    email: "zombie-owner@example.com",
  });
  ownerId = u.id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM jars WHERE owner_id = $1", [ownerId]);
  const jars = await Promise.all(
    ["A", "B", "C"].map((name) =>
      jarQueries.createJar(pool, {
        ownerId,
        name: `Zombie Jar ${name}`,
        appearance: makeJarAppearance(),
        config: makeJarConfig(),
      }),
    ),
  );
  jarA = jars[0].id;
  jarB = jars[1].id;
  jarC = jars[2].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [ownerId]);
  await pool.end();
});

describe("closeZombieRooms", () => {
  it("closes a stale open room with no presence", async () => {
    const room = await roomQueries.createRoom(pool, { jarId: jarA });
    // Backdate created_at past the grace period.
    await pool.query("UPDATE rooms SET created_at = now() - interval '1 hour' WHERE id = $1", [
      room.id,
    ]);
    const closed = await closeZombieRooms(pool, fakePresence({}), 30);
    expect(closed).toBe(1);
    const fresh = await roomQueries.getRoomById(pool, room.id);
    expect(fresh?.state).toBe("closed");
  });

  it("leaves a fresh open room alone (within the grace period)", async () => {
    const room = await roomQueries.createRoom(pool, { jarId: jarA });
    const closed = await closeZombieRooms(pool, fakePresence({}), 30);
    expect(closed).toBe(0);
    const fresh = await roomQueries.getRoomById(pool, room.id);
    expect(fresh?.state).toBe("open");
  });

  it("leaves a stale room with active presence alone", async () => {
    const room = await roomQueries.createRoom(pool, { jarId: jarB });
    await pool.query("UPDATE rooms SET created_at = now() - interval '1 hour' WHERE id = $1", [
      room.id,
    ]);
    const closed = await closeZombieRooms(pool, fakePresence({ [room.id]: 2 }), 30);
    expect(closed).toBe(0);
    const fresh = await roomQueries.getRoomById(pool, room.id);
    expect(fresh?.state).toBe("open");
  });

  it("ignores already-closed rooms", async () => {
    const room = await roomQueries.createRoom(pool, { jarId: jarC });
    await pool.query(
      "UPDATE rooms SET state = 'closed', created_at = now() - interval '1 hour' WHERE id = $1",
      [room.id],
    );
    const closed = await closeZombieRooms(pool, fakePresence({}), 30);
    expect(closed).toBe(0);
  });

  it("caps how many rooms it closes per invocation", async () => {
    // One-active-room-per-jar means we need distinct jars to park multiple
    // stale rooms. Create extras beyond the explicit cap we pass in.
    const extraJars = await Promise.all(
      ["D", "E", "F"].map((name) =>
        jarQueries.createJar(pool, {
          ownerId,
          name: `Zombie Jar ${name}`,
          appearance: makeJarAppearance(),
          config: makeJarConfig(),
        }),
      ),
    );
    const extraJarIds: string[] = extraJars.map((jar: { id: string }) => jar.id);
    const allRooms = await Promise.all(
      [jarA, jarB, jarC, ...extraJarIds].map((jarId) => roomQueries.createRoom(pool, { jarId })),
    );
    await pool.query(
      "UPDATE rooms SET created_at = now() - interval '1 hour' WHERE id = ANY($1::uuid[])",
      [allRooms.map((r) => r.id)],
    );
    const closed = await closeZombieRooms(pool, fakePresence({}), 30, 2);
    expect(closed).toBe(2);
    const leftOpen = await pool.query(
      "SELECT count(*)::int AS n FROM rooms WHERE id = ANY($1::uuid[]) AND state != 'closed'",
      [allRooms.map((r) => r.id)],
    );
    expect(leftOpen.rows[0].n).toBe(4);
  });

  it("re-checks presence before updating (skips rooms that filled in mid-sweep)", async () => {
    const room = await roomQueries.createRoom(pool, { jarId: jarA });
    await pool.query("UPDATE rooms SET created_at = now() - interval '1 hour' WHERE id = $1", [
      room.id,
    ]);
    // Presence reports 0 on the first check (matching the initial SELECT) but
    // jumps to 1 before we attempt the UPDATE — simulates a user joining in
    // the race window. The sweep must not close this now-live room.
    let call = 0;
    const presence: PresenceStore = {
      memberCount: vi.fn(async () => (call++ === 0 ? 0 : 1)),
      addMember: vi.fn(),
      addMemberIfUnderCap: vi.fn(),
      removeMember: vi.fn(),
      getMember: vi.fn(),
      getMembers: vi.fn(),
      hasMember: vi.fn(),
      clearRoom: vi.fn(),
      reconcile: vi.fn(),
    } as unknown as PresenceStore;
    const closed = await closeZombieRooms(pool, presence, 30);
    expect(closed).toBe(0);
    const fresh = await roomQueries.getRoomById(pool, room.id);
    expect(fresh?.state).toBe("open");
  });
});
