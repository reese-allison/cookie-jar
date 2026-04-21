import { createServer } from "node:http";
import pg from "pg";
import { type Socket as ClientSocket, io as ioClient } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as roomQueries from "../../../src/server/db/queries/rooms";
import * as userQueries from "../../../src/server/db/queries/users";
import { createSocketServer } from "../../../src/server/socket/server";
import type { ServerToClientEvents } from "../../../src/shared/types";

let pool: pg.Pool;
let testUserId: string;
let testJarId: string;
let testRoomCode: string;
let httpServer: ReturnType<typeof createServer>;
let port: number;

function connectClient(roomCode?: string, displayName?: string): ClientSocket {
  const client = ioClient(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ["websocket"],
  });
  if (roomCode) {
    client.on("connect", () => {
      client.emit("room:join", roomCode, displayName ?? "TestUser");
    });
  }
  return client;
}

function waitForEvent<K extends keyof ServerToClientEvents>(
  client: ClientSocket,
  event: K,
  timeoutMs = 2000,
): Promise<Parameters<ServerToClientEvents[K]>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    client.once(event as string, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args as Parameters<ServerToClientEvents[K]>);
    });
  });
}

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });

  const user = await userQueries.createUser(pool, {
    displayName: "Socket Test User",
    email: "test-socket@example.com",
  });
  testUserId = user.id;

  const jar = await jarQueries.createJar(pool, {
    ownerId: testUserId,
    name: "Socket Test Jar",
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

  // Start a test HTTP + Socket.io server
  httpServer = createServer();
  createSocketServer(httpServer);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
});

beforeEach(async () => {
  await pool.query("DELETE FROM rooms WHERE jar_id = $1", [testJarId]);
  const room = await roomQueries.createRoom(pool, { jarId: testJarId });
  testRoomCode = room.code;
});

const clients: ClientSocket[] = [];
afterEach(() => {
  for (const c of clients) {
    if (c.connected) c.disconnect();
  }
  clients.length = 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await pool.query("DELETE FROM jars WHERE id = $1", [testJarId]);
  await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  await pool.end();
});

describe("room socket handlers", () => {
  it("joins a room and receives room state", async () => {
    const client = connectClient(testRoomCode, "Alice");
    clients.push(client);

    const statePromise = waitForEvent(client, "room:state");
    client.connect();

    const [room] = await statePromise;
    expect(room.code).toBe(testRoomCode);
    expect(room.members).toHaveLength(1);
    expect(room.members[0].displayName).toBe("Alice");
  });

  it("broadcasts member_joined to existing users", async () => {
    const alice = connectClient(testRoomCode, "Alice");
    clients.push(alice);

    const aliceReady = waitForEvent(alice, "room:state");
    alice.connect();
    await aliceReady;

    // Now Bob joins — Alice should receive member_joined
    const bob = connectClient(testRoomCode, "Bob");
    clients.push(bob);

    const joinPromise = waitForEvent(alice, "room:member_joined");
    bob.connect();

    const [member] = await joinPromise;
    expect(member.displayName).toBe("Bob");
  });

  it("broadcasts member_left when a user disconnects", async () => {
    const alice = connectClient(testRoomCode, "Alice");
    const bob = connectClient(testRoomCode, "Bob");
    clients.push(alice, bob);

    alice.connect();
    await waitForEvent(alice, "room:state");

    bob.connect();
    await waitForEvent(bob, "room:state");

    const leavePromise = waitForEvent(alice, "room:member_left");
    bob.disconnect();

    const [memberId] = await leavePromise;
    expect(memberId).toBeDefined();
  });
});

describe("cursor broadcasting", () => {
  it("broadcasts cursor position to other users in the room", async () => {
    const alice = connectClient(testRoomCode, "Alice");
    const bob = connectClient(testRoomCode, "Bob");
    clients.push(alice, bob);

    alice.connect();
    await waitForEvent(alice, "room:state");

    bob.connect();
    await waitForEvent(bob, "room:state");

    // Alice moves cursor — Bob should see it
    const cursorPromise = waitForEvent(bob, "cursor:moved");
    alice.emit("cursor:move", { x: 100, y: 200 });

    const [cursor] = await cursorPromise;
    expect(cursor.x).toBe(100);
    expect(cursor.y).toBe(200);
    expect(cursor.userId).toBe(alice.id);
  });

  it("does not broadcast cursor to the sender", async () => {
    const alice = connectClient(testRoomCode, "Alice");
    clients.push(alice);

    alice.connect();
    await waitForEvent(alice, "room:state");

    // Alice should NOT receive her own cursor back
    let received = false;
    alice.on("cursor:moved", () => {
      received = true;
    });
    alice.emit("cursor:move", { x: 50, y: 50 });

    // Wait a bit to confirm no event arrives
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toBe(false);
  });
});

// Lock/unlock moved into jarConfig.locked — owner toggles via PATCH
// /api/jars/:id + jar:refresh. There's no dedicated room:lock socket event
// anymore, so there's nothing to test at this layer.

describe("jar:refresh", () => {
  it("rejects jar:refresh from anonymous user (not owner)", async () => {
    const alice = connectClient(testRoomCode, "Alice");
    clients.push(alice);

    alice.connect();
    await waitForEvent(alice, "room:state");

    const errorPromise = waitForEvent(alice, "room:error");
    alice.emit("jar:refresh");

    const [error] = await errorPromise;
    expect(error).toContain("owner");
  });
});

describe("room errors", () => {
  it("emits error when joining a non-existent room", async () => {
    const client = ioClient(`http://localhost:${port}`, {
      autoConnect: false,
      transports: ["websocket"],
    });
    clients.push(client);

    client.connect();
    await new Promise<void>((resolve) => client.on("connect", resolve));

    const errorPromise = waitForEvent(client, "room:error");
    client.emit("room:join", "ZZZZZZ", "Ghost");

    const [error] = await errorPromise;
    expect(error).toContain("not found");
  });
});
