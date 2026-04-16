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
    config: { noteVisibility: "open", sealedRevealCount: 1, showAuthors: false },
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
    // Pre-populate some notes
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

describe("note:add", () => {
  it("creates a note and broadcasts to the room", async () => {
    const alice = connectClient(testRoomCode, "Alice");
    const bob = connectClient(testRoomCode, "Bob");
    clients.push(alice, bob);

    alice.connect();
    await waitForEvent(alice, "room:state");

    bob.connect();
    await waitForEvent(bob, "room:state");

    // Bob listens for the broadcast
    const addedPromise = waitForEvent(bob, "note:added");

    // Alice adds a note
    alice.emit("note:add", { text: "Go hiking", style: "sticky" });

    const [note, inJarCount] = await addedPromise;
    expect(note.text).toBe("Go hiking");
    expect(note.state).toBe("in_jar");
    expect(inJarCount).toBe(1);
  });
});

describe("note:pull", () => {
  it("pulls a random note and broadcasts to the room", async () => {
    // Pre-populate a note
    await noteQueries.createNote(pool, { jarId: testJarId, text: "Surprise!", style: "sticky" });

    const alice = connectClient(testRoomCode, "Alice");
    clients.push(alice);

    alice.connect();
    await waitForEvent(alice, "room:state");

    const pulledPromise = waitForEvent(alice, "note:pulled");
    alice.emit("note:pull");

    const [note, pulledBy] = await pulledPromise;
    expect(note.text).toBe("Surprise!");
    expect(note.state).toBe("pulled");
    expect(pulledBy).toBeDefined();
  });

  it("rejects pull when jar is empty", async () => {
    const alice = connectClient(testRoomCode, "Alice");
    clients.push(alice);

    alice.connect();
    await waitForEvent(alice, "room:state");

    const rejectedPromise = waitForEvent(alice, "pull:rejected");
    alice.emit("note:pull");

    const [reason] = await rejectedPromise;
    expect(reason).toContain("empty");
  });
});

describe("note:discard", () => {
  it("discards a pulled note and broadcasts", async () => {
    const created = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Discard me",
      style: "sticky",
    });
    await noteQueries.updateNoteState(pool, created.id, "pulled");

    const alice = connectClient(testRoomCode, "Alice");
    clients.push(alice);

    alice.connect();
    await waitForEvent(alice, "room:state");

    const discardPromise = waitForEvent(alice, "note:discarded");
    alice.emit("note:discard", created.id);

    const [noteId] = await discardPromise;
    expect(noteId).toBe(created.id);
  });
});

describe("note:return", () => {
  it("returns a pulled note to the jar and broadcasts", async () => {
    const created = await noteQueries.createNote(pool, {
      jarId: testJarId,
      text: "Return me",
      style: "sticky",
    });
    await noteQueries.updateNoteState(pool, created.id, "pulled");

    const alice = connectClient(testRoomCode, "Alice");
    clients.push(alice);

    alice.connect();
    await waitForEvent(alice, "room:state");

    const returnPromise = waitForEvent(alice, "note:returned");
    alice.emit("note:return", created.id);

    const [noteId, inJarCount] = await returnPromise;
    expect(noteId).toBe(created.id);
    expect(inJarCount).toBe(1);
  });
});
