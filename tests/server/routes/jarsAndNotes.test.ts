import express from "express";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the auth middleware so each test controls req.user without a real
// better-auth session. Must run before importing the routers.
interface MockUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
}
const authState: { user: MockUser | null } = {
  user: null,
};
vi.mock("../../../src/server/middleware/requireAuth", () => ({
  getUser: (req: { user?: MockUser }) => {
    if (!req.user) throw new Error("requireAuth middleware not applied");
    return req.user;
  },
  requireAuth: (
    req: { user?: MockUser | null },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = authState.user;
    next();
  },
  attachUser: (req: { user?: MockUser | null }, _res: unknown, next: () => void) => {
    if (authState.user) req.user = authState.user;
    next();
  },
}));

import * as jarQueries from "../../../src/server/db/queries/jars";
import * as noteQueries from "../../../src/server/db/queries/notes";
import * as starQueries from "../../../src/server/db/queries/starredJars";
import * as userQueries from "../../../src/server/db/queries/users";
import { jarRouter } from "../../../src/server/routes/jars";
import { noteRouter } from "../../../src/server/routes/notes";
import { roomRouter } from "../../../src/server/routes/rooms";
import { makeJarAppearance, makeJarConfig } from "../../helpers/fixtures";

let pool: pg.Pool;
let ownerId: string;
let friendId: string;
let strangerId: string;

const app = express();
app.use(express.json());
app.use("/api/jars", jarRouter);
app.use("/api/notes", noteRouter);
app.use("/api/rooms", roomRouter);

function asOwner(): void {
  authState.user = {
    id: ownerId,
    email: "rest-owner@example.com",
    emailVerified: true,
    name: "Owner",
  };
}
function asFriend(): void {
  authState.user = {
    id: friendId,
    email: "rest-friend@example.com",
    emailVerified: true,
    name: "Friend",
  };
}
function asStranger(): void {
  authState.user = {
    id: strangerId,
    email: "rest-stranger@example.com",
    emailVerified: true,
    name: "Stranger",
  };
}
function asAnon(): void {
  authState.user = null;
}

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });
  const [owner, friend, stranger] = await Promise.all([
    userQueries.createUser(pool, { displayName: "Owner", email: "rest-owner@example.com" }),
    userQueries.createUser(pool, { displayName: "Friend", email: "rest-friend@example.com" }),
    userQueries.createUser(pool, {
      displayName: "Stranger",
      email: "rest-stranger@example.com",
    }),
  ]);
  ownerId = owner.id;
  friendId = friend.id;
  strangerId = stranger.id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM jars WHERE owner_id = $1", [ownerId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [ownerId, friendId, strangerId]);
  await pool.end();
});

async function createTestJar(overrides: Parameters<typeof makeJarConfig>[0] = {}) {
  return jarQueries.createJar(pool, {
    ownerId,
    name: "Jar",
    appearance: makeJarAppearance(),
    config: makeJarConfig(overrides),
  });
}

describe("GET /api/jars/:id — allowlist", () => {
  it("returns 200 for the owner", async () => {
    const jar = await createTestJar();
    asOwner();
    const res = await request(app).get(`/api/jars/${jar.id}`);
    expect(res.status).toBe(200);
  });

  it("returns 403 for a stranger on a private jar without allowlist", async () => {
    const jar = await createTestJar();
    asStranger();
    const res = await request(app).get(`/api/jars/${jar.id}`);
    expect(res.status).toBe(403);
  });

  it("returns 200 for an allowlisted user", async () => {
    const jar = await createTestJar({ allowedEmails: ["rest-friend@example.com"] });
    asFriend();
    const res = await request(app).get(`/api/jars/${jar.id}`);
    expect(res.status).toBe(200);
  });

  it("returns 200 for anyone on a public jar", async () => {
    const jar = await jarQueries.createJar(pool, {
      ownerId,
      name: "Public Jar",
      appearance: makeJarAppearance(),
      config: makeJarConfig(),
      isPublic: true,
    });
    asAnon();
    const res = await request(app).get(`/api/jars/${jar.id}`);
    expect(res.status).toBe(200);
  });
});

describe("PUT/DELETE /api/jars/:id/star", () => {
  it("owner can't star their own jar (400)", async () => {
    const jar = await createTestJar();
    asOwner();
    const res = await request(app).put(`/api/jars/${jar.id}/star`);
    expect(res.status).toBe(400);
  });

  it("stranger with no access gets 403 starring a private jar", async () => {
    const jar = await createTestJar({ allowedEmails: ["rest-friend@example.com"] });
    asStranger();
    const res = await request(app).put(`/api/jars/${jar.id}/star`);
    expect(res.status).toBe(403);
  });

  it("allowlisted user can star (204) and unstar (204)", async () => {
    const jar = await createTestJar({ allowedEmails: ["rest-friend@example.com"] });
    asFriend();
    let res = await request(app).put(`/api/jars/${jar.id}/star`);
    expect(res.status).toBe(204);
    expect(await starQueries.isStarred(pool, friendId, jar.id)).toBe(true);
    res = await request(app).delete(`/api/jars/${jar.id}/star`);
    expect(res.status).toBe(204);
    expect(await starQueries.isStarred(pool, friendId, jar.id)).toBe(false);
  });

  it("legacy code-holder (no allowlist) can star", async () => {
    // Private jar with no allowlist — canJoinJar returns true for anyone,
    // and star should follow the same rule (B7).
    const jar = await createTestJar();
    asStranger();
    const res = await request(app).put(`/api/jars/${jar.id}/star`);
    expect(res.status).toBe(204);
  });
});

describe("GET /api/jars/mine", () => {
  it("returns owned and starred in separate lists with hasAccess", async () => {
    const mine = await createTestJar();
    const friendsJar = await jarQueries.createJar(pool, {
      ownerId: friendId,
      name: "Friend Jar",
      appearance: makeJarAppearance(),
      config: makeJarConfig({ allowedEmails: ["rest-owner@example.com"] }),
    });
    await starQueries.starJar(pool, ownerId, friendsJar.id);

    asOwner();
    const res = await request(app).get("/api/jars/mine");
    expect(res.status).toBe(200);
    expect(res.body.ownedJars.map((j: { id: string }) => j.id)).toContain(mine.id);
    expect(res.body.starredJars).toHaveLength(1);
    expect(res.body.starredJars[0].id).toBe(friendsJar.id);
    expect(res.body.starredJars[0].hasAccess).toBe(true);
    // Cleanup
    await pool.query("DELETE FROM jars WHERE id = $1", [friendsJar.id]);
  });

  it("hasAccess=true for a starred jar with no allowlist (code-holder)", async () => {
    // Owner is the friend account; the "stranger" user joined via room
    // code (no allowlist), starred, and reopens My Jars. canJoinJar
    // permits them, so hasAccess must be true — otherwise the My Jars
    // tombstone fires for someone who can still play.
    const friendsJar = await jarQueries.createJar(pool, {
      ownerId: friendId,
      name: "Code-holder Jar",
      appearance: makeJarAppearance(),
      config: makeJarConfig(),
    });
    await starQueries.starJar(pool, strangerId, friendsJar.id);
    asStranger();
    const res = await request(app).get("/api/jars/mine");
    expect(res.body.starredJars[0].hasAccess).toBe(true);
    await pool.query("DELETE FROM jars WHERE id = $1", [friendsJar.id]);
  });

  it("marks starred jars with lost access as hasAccess=false", async () => {
    const friendsJar = await jarQueries.createJar(pool, {
      ownerId: friendId,
      name: "Friend Jar",
      appearance: makeJarAppearance(),
      config: makeJarConfig({ allowedEmails: ["rest-owner@example.com"] }),
    });
    await starQueries.starJar(pool, ownerId, friendsJar.id);
    // Owner gets yanked from allowlist — friend keeps a different invite so
    // the allowlist stays non-empty (an empty allowlist falls back to the
    // code-holder rule and would let anyone join, masking the test).
    await jarQueries.updateJar(pool, friendsJar.id, {
      config: makeJarConfig({ allowedEmails: ["someone-else@example.com"] }),
    });

    asOwner();
    const res = await request(app).get("/api/jars/mine");
    expect(res.body.starredJars[0].hasAccess).toBe(false);
    await pool.query("DELETE FROM jars WHERE id = $1", [friendsJar.id]);
  });
});

describe("POST /api/rooms — access + one-active", () => {
  it("allowlisted user can create a room", async () => {
    const jar = await createTestJar({ allowedEmails: ["rest-friend@example.com"] });
    asFriend();
    const res = await request(app).post("/api/rooms").send({ jarId: jar.id });
    expect(res.status).toBe(201);
    expect(res.body.code).toBeDefined();
  });

  it("stranger NOT on an allowlist gets 403", async () => {
    // Jar with an allowlist that excludes the stranger. canJoinJar returns
    // false only when an allowlist exists and the viewer isn't on it.
    const jar = await createTestJar({ allowedEmails: ["rest-friend@example.com"] });
    asStranger();
    const res = await request(app).post("/api/rooms").send({ jarId: jar.id });
    expect(res.status).toBe(403);
  });

  it("code-holder on a private jar without an allowlist can create a room", async () => {
    // Mirrors "People who star a jar can open a room without being the owner":
    // if canJoinJar passes for this viewer (same rule the star endpoint uses),
    // they may also reopen the jar when no active room exists.
    const jar = await createTestJar();
    asStranger();
    const res = await request(app).post("/api/rooms").send({ jarId: jar.id });
    expect(res.status).toBe(201);
  });

  it("returns the existing active room (200) instead of creating a second", async () => {
    const jar = await createTestJar();
    asOwner();
    const first = await request(app).post("/api/rooms").send({ jarId: jar.id });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/rooms").send({ jarId: jar.id });
    expect(second.status).toBe(200);
    expect(second.body.code).toBe(first.body.code);
  });
});

describe("POST /api/notes lock enforcement", () => {
  it("rejects add with 409 when the jar is locked", async () => {
    const jar = await createTestJar({ locked: true });
    asOwner();
    const res = await request(app).post("/api/notes").send({ jarId: jar.id, text: "while locked" });
    expect(res.status).toBe(409);
  });

  it("allows add on an unlocked jar", async () => {
    const jar = await createTestJar();
    asOwner();
    const res = await request(app).post("/api/notes").send({ jarId: jar.id, text: "hi" });
    expect(res.status).toBe(201);
  });
});

describe("DELETE /api/notes/:id lock enforcement", () => {
  it("rejects delete on a locked jar", async () => {
    const jar = await createTestJar();
    const note = await noteQueries.createNote(pool, {
      jarId: jar.id,
      text: "seed",
      style: "sticky",
    });
    await jarQueries.updateJar(pool, jar.id, { config: makeJarConfig({ locked: true }) });
    asOwner();
    const res = await request(app).delete(`/api/notes/${note.id}`);
    expect(res.status).toBe(409);
  });
});

describe("POST /api/notes/bulk-import lock enforcement", () => {
  it("rejects bulk-import on a locked jar", async () => {
    const jar = await createTestJar({ locked: true });
    asOwner();
    const res = await request(app)
      .post("/api/notes/bulk-import")
      .send({ jarId: jar.id, texts: ["a", "b"] });
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/notes/:id/state lock enforcement", () => {
  it("discard-via-state rejected on a locked jar; in_jar↔pulled allowed", async () => {
    const jar = await createTestJar();
    const note = await noteQueries.createNote(pool, {
      jarId: jar.id,
      text: "seed",
      style: "sticky",
    });
    await jarQueries.updateJar(pool, jar.id, { config: makeJarConfig({ locked: true }) });
    asOwner();
    const discarded = await request(app)
      .patch(`/api/notes/${note.id}/state`)
      .send({ state: "discarded" });
    expect(discarded.status).toBe(409);
    // Curation (pull) still fine.
    const pulled = await request(app)
      .patch(`/api/notes/${note.id}/state`)
      .send({ state: "pulled" });
    expect(pulled.status).toBe(200);
  });
});

describe("POST /api/rooms — one active room per jar", () => {
  it("returns the existing room on the second create for the same jar", async () => {
    const jar = await createTestJar();
    asOwner();
    const first = await request(app).post("/api/rooms").send({ jarId: jar.id });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/rooms").send({ jarId: jar.id });
    // Fast-path: listActiveRoomsForJar already returns the winner, so the
    // route short-circuits to 200 with the same id.
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it("recovers from a 23505 race by returning the winner with 200", async () => {
    const jar = await createTestJar();
    asOwner();
    // Race both requests so neither sees the other's row in the pre-insert
    // fast-path check. One wins the INSERT, the other trips the partial
    // unique index and falls into the catch block's re-query.
    const [a, b] = await Promise.all([
      request(app).post("/api/rooms").send({ jarId: jar.id }),
      request(app).post("/api/rooms").send({ jarId: jar.id }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
  });
});
