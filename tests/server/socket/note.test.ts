import { createServer } from "node:http";
import pg from "pg";
import { type Socket as ClientSocket, io as ioClient } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as noteQueries from "../../../src/server/db/queries/notes";
import * as roomQueries from "../../../src/server/db/queries/rooms";
import * as userQueries from "../../../src/server/db/queries/users";
import { createSocketServer } from "../../../src/server/socket/server";
import type { NoteStatePayload, ServerToClientEvents } from "../../../src/shared/types";

let pool: pg.Pool;
let testUserId: string;
let testJarId: string;
let testRoomCode: string;
let httpServer: ReturnType<typeof createServer>;
let port: number;

function connectClient(roomCode: string, displayName: string): ClientSocket {
  const client = ioClient(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ["websocket"],
  });
  client.on("connect", () => {
    client.emit("room:join", roomCode, displayName);
  });
  return client;
}

function waitForEvent<K extends keyof ServerToClientEvents>(
  client: ClientSocket,
  event: K,
  timeoutMs = 3000,
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
    displayName: "Note Socket Test User",
    email: "test-note-socket@example.com",
  });
  testUserId = user.id;

  const jar = await jarQueries.createJar(pool, {
    ownerId: testUserId,
    name: "Note Socket Test Jar",
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
  await pool.query("DELETE FROM notes WHERE jar_id = $1", [testJarId]);
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

describe("note:state on join", () => {
  it("sends note state when a user joins a room", async () => {
    await noteQueries.createNote(pool, { jarId: testJarId, text: "Note 1", style: "sticky" });
    await noteQueries.createNote(pool, { jarId: testJarId, text: "Note 2", style: "sticky" });
    const pulled = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Pulled Note",
      style: "sticky",
    });
    await noteQueries.updateNoteState(pool, pulled.id, "pulled");

    const client = connectClient(testRoomCode, "Alice");
    clients.push(client);

    const noteStatePromise = waitForEvent(client, "note:state");
    client.connect();

    const [noteState] = noteStatePromise instanceof Promise ? await noteStatePromise : [null];
    const state = noteState as unknown as NoteStatePayload;
    expect(state.inJarCount).toBe(2);
    expect(state.pulledNotes).toHaveLength(1);
    expect(state.pulledNotes[0].text).toBe("Pulled Note");
  });
});

describe("anonymous user restrictions", () => {
  it("rejects note:add from anonymous user", async () => {
    const client = connectClient(testRoomCode, "Guest");
    clients.push(client);

    client.connect();
    await waitForEvent(client, "room:state");

    const errorPromise = waitForEvent(client, "room:error");
    client.emit("note:add", { text: "Should fail", style: "sticky" });

    const [error] = await errorPromise;
    expect(error).toContain("Sign in");
  });

  it("rejects note:pull from anonymous user", async () => {
    await noteQueries.createNote(pool, { jarId: testJarId, text: "In jar", style: "sticky" });

    const client = connectClient(testRoomCode, "Guest");
    clients.push(client);

    client.connect();
    await waitForEvent(client, "room:state");

    const errorPromise = waitForEvent(client, "room:error");
    client.emit("note:pull");

    const [error] = await errorPromise;
    expect(error).toContain("Sign in");
  });

  it("rejects note:discard from anonymous user", async () => {
    const note = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Pulled",
      style: "sticky",
    });
    await noteQueries.updateNoteState(pool, note.id, "pulled");

    const client = connectClient(testRoomCode, "Guest");
    clients.push(client);

    client.connect();
    await waitForEvent(client, "room:state");

    const errorPromise = waitForEvent(client, "room:error");
    client.emit("note:discard", note.id);

    const [error] = await errorPromise;
    expect(error).toContain("Sign in");
  });
});
