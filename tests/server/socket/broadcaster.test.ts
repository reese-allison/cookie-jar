import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note, NoteStatePayload } from "../../../src/shared/types";

// Mock the DB query modules that broadcaster.ts pulls in at import time —
// everything here is in-memory, no pool required. We swap the fakes per-test.
const listActiveRoomsForJarMock = vi.fn();
const countNotesByStateMock = vi.fn();
const updateRoomStateMock = vi.fn();

vi.mock("../../../src/server/db/queries/rooms", () => ({
  listActiveRoomsForJar: (...args: unknown[]) => listActiveRoomsForJarMock(...args),
  updateRoomState: (...args: unknown[]) => updateRoomStateMock(...args),
}));
vi.mock("../../../src/server/db/queries/notes", () => ({
  countNotesByState: (...args: unknown[]) => countNotesByStateMock(...args),
}));
vi.mock("../../../src/server/db/pool", () => ({
  default: {},
}));

import {
  broadcastJarNoteState,
  broadcastNoteUpdated,
  disconnectJarRooms,
  removeFromSealedBuffers,
  resetSocketServer,
  setSocketServer,
  updateSealedBuffers,
} from "../../../src/server/socket/broadcaster";
import type { SealedNotesStore } from "../../../src/server/socket/sealedNotesStore";
import type { TypedServer } from "../../../src/server/socket/server";

interface FakeRoomScope {
  emit: ReturnType<typeof vi.fn>;
  disconnectSockets: ReturnType<typeof vi.fn>;
}

function makeFakeIo(): { io: TypedServer; byRoom: Map<string, FakeRoomScope> } {
  const byRoom = new Map<string, FakeRoomScope>();
  function scope(id: string): FakeRoomScope {
    let s = byRoom.get(id);
    if (!s) {
      s = { emit: vi.fn(), disconnectSockets: vi.fn() };
      byRoom.set(id, s);
    }
    return s;
  }
  const io = {
    to: (id: string) => ({ emit: scope(id).emit }),
    in: (id: string) => ({ disconnectSockets: scope(id).disconnectSockets }),
  } as unknown as TypedServer;
  return { io, byRoom };
}

function makeFakeSealedStore(): SealedNotesStore {
  return {
    push: vi.fn(),
    revealIfReady: vi.fn(),
    drain: vi.fn(),
    remove: vi.fn(async () => undefined),
    updateInBuffer: vi.fn(async () => undefined),
    length: vi.fn(),
    clear: vi.fn(),
  };
}

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: "note-1",
  jarId: "jar-1",
  text: "hi",
  style: "sticky",
  state: "pulled",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  listActiveRoomsForJarMock.mockReset();
  countNotesByStateMock.mockReset();
  updateRoomStateMock.mockReset();
  resetSocketServer();
});

afterEach(() => {
  resetSocketServer();
});

describe("broadcaster (socket-to-REST facade)", () => {
  describe("when the socket server is not wired", () => {
    it("removeFromSealedBuffers is a silent no-op", async () => {
      await expect(removeFromSealedBuffers("jar-1", "note-1")).resolves.toBeUndefined();
      expect(listActiveRoomsForJarMock).not.toHaveBeenCalled();
    });

    it("updateSealedBuffers is a silent no-op", async () => {
      await expect(updateSealedBuffers(makeNote())).resolves.toBeUndefined();
    });

    it("broadcastJarNoteState is a silent no-op", async () => {
      await expect(broadcastJarNoteState("jar-1")).resolves.toBeUndefined();
      expect(listActiveRoomsForJarMock).not.toHaveBeenCalled();
    });

    it("broadcastNoteUpdated is a silent no-op", async () => {
      await expect(broadcastNoteUpdated(makeNote())).resolves.toBeUndefined();
    });

    it("disconnectJarRooms is a silent no-op", async () => {
      await expect(disconnectJarRooms("jar-1", "gone")).resolves.toBeUndefined();
    });
  });

  describe("broadcastNoteUpdated", () => {
    it("emits note:updated to every active room for the jar", async () => {
      const { io, byRoom } = makeFakeIo();
      setSocketServer(io);
      listActiveRoomsForJarMock.mockResolvedValueOnce([{ id: "room-A" }, { id: "room-B" }]);
      const note = makeNote({ id: "n42", text: "edited" });
      await broadcastNoteUpdated(note);
      expect(byRoom.get("room-A")?.emit).toHaveBeenCalledWith("note:updated", note);
      expect(byRoom.get("room-B")?.emit).toHaveBeenCalledWith("note:updated", note);
    });

    it("is a no-op when the jar has no active rooms", async () => {
      const { io, byRoom } = makeFakeIo();
      setSocketServer(io);
      listActiveRoomsForJarMock.mockResolvedValueOnce([]);
      await broadcastNoteUpdated(makeNote());
      expect(byRoom.size).toBe(0);
    });
  });

  describe("broadcastJarNoteState", () => {
    it("emits a compact payload with the current in-jar count", async () => {
      const { io, byRoom } = makeFakeIo();
      setSocketServer(io);
      listActiveRoomsForJarMock.mockResolvedValueOnce([{ id: "room-1" }]);
      countNotesByStateMock.mockResolvedValueOnce(7);
      await broadcastJarNoteState("jar-1");
      const expected: NoteStatePayload = { inJarCount: 7 };
      expect(byRoom.get("room-1")?.emit).toHaveBeenCalledWith("note:state", expected);
    });

    it("merges caller-supplied extras into the payload", async () => {
      const { io, byRoom } = makeFakeIo();
      setSocketServer(io);
      listActiveRoomsForJarMock.mockResolvedValueOnce([{ id: "room-1" }]);
      countNotesByStateMock.mockResolvedValueOnce(3);
      await broadcastJarNoteState("jar-1", { jarAppearance: { label: "x" } });
      const call = (byRoom.get("room-1")?.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe("note:state");
      expect(call[1]).toMatchObject({ inJarCount: 3, jarAppearance: { label: "x" } });
    });
  });

  describe("updateSealedBuffers / removeFromSealedBuffers", () => {
    it("updateSealedBuffers replaces the note in every room's buffer", async () => {
      const { io } = makeFakeIo();
      const store = makeFakeSealedStore();
      setSocketServer(io, store);
      listActiveRoomsForJarMock.mockResolvedValueOnce([{ id: "room-X" }, { id: "room-Y" }]);
      const note = makeNote({ id: "edit-me" });
      await updateSealedBuffers(note);
      expect(store.updateInBuffer).toHaveBeenCalledWith("room-X", note);
      expect(store.updateInBuffer).toHaveBeenCalledWith("room-Y", note);
    });

    it("removeFromSealedBuffers drops the id from every active room", async () => {
      const { io } = makeFakeIo();
      const store = makeFakeSealedStore();
      setSocketServer(io, store);
      listActiveRoomsForJarMock.mockResolvedValueOnce([{ id: "room-X" }, { id: "room-Y" }]);
      await removeFromSealedBuffers("jar-1", "gone");
      expect(store.remove).toHaveBeenCalledWith("room-X", "gone");
      expect(store.remove).toHaveBeenCalledWith("room-Y", "gone");
    });

    it("swallows errors from sealedStore so a REST write never fails", async () => {
      const { io } = makeFakeIo();
      const store = makeFakeSealedStore();
      (store.remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
      setSocketServer(io, store);
      listActiveRoomsForJarMock.mockResolvedValueOnce([{ id: "room-X" }]);
      await expect(removeFromSealedBuffers("jar-1", "x")).resolves.toBeUndefined();
    });
  });

  describe("disconnectJarRooms", () => {
    it("emits room:error, kicks sockets, and marks the room closed for each active room", async () => {
      const { io, byRoom } = makeFakeIo();
      setSocketServer(io);
      listActiveRoomsForJarMock.mockResolvedValueOnce([{ id: "room-A" }, { id: "room-B" }]);
      updateRoomStateMock.mockResolvedValue({});
      await disconnectJarRooms("jar-1", "Jar deleted");
      expect(byRoom.get("room-A")?.emit).toHaveBeenCalledWith("room:error", "Jar deleted");
      expect(byRoom.get("room-A")?.disconnectSockets).toHaveBeenCalled();
      expect(updateRoomStateMock).toHaveBeenCalledWith(expect.anything(), "room-A", "closed");
      expect(updateRoomStateMock).toHaveBeenCalledWith(expect.anything(), "room-B", "closed");
    });

    it("swallows DB errors so a delete request still completes", async () => {
      const { io } = makeFakeIo();
      setSocketServer(io);
      listActiveRoomsForJarMock.mockRejectedValueOnce(new Error("db down"));
      await expect(disconnectJarRooms("jar-1", "Jar deleted")).resolves.toBeUndefined();
    });
  });
});
