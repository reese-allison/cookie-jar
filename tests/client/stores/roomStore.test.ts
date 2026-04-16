/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useRoomStore } from "../../../src/client/stores/roomStore";
import type { Room, RoomMember } from "../../../src/shared/types";

const TEST_ROOM: Room = {
  id: "room-1",
  code: "AB2CDE",
  jarId: "jar-1",
  state: "open",
  maxParticipants: 20,
  maxViewers: 50,
  idleTimeoutMinutes: 30,
  members: [],
  createdAt: new Date().toISOString(),
};

const TEST_MEMBER: RoomMember = {
  id: "member-1",
  displayName: "Alice",
  role: "contributor",
  color: "#FF6B6B",
  connectedAt: new Date().toISOString(),
};

beforeEach(() => {
  useRoomStore.getState().reset();
});

describe("roomStore", () => {
  it("sets room state", () => {
    useRoomStore.getState().setRoom(TEST_ROOM);
    expect(useRoomStore.getState().room).toEqual(TEST_ROOM);
    expect(useRoomStore.getState().isJoining).toBe(false);
  });

  it("adds a member", () => {
    useRoomStore.getState().setRoom(TEST_ROOM);
    useRoomStore.getState().addMember(TEST_MEMBER);

    const members = useRoomStore.getState().room?.members;
    expect(members).toHaveLength(1);
    expect(members?.[0].displayName).toBe("Alice");
  });

  it("removes a member and their cursor", () => {
    useRoomStore.getState().setRoom({ ...TEST_ROOM, members: [TEST_MEMBER] });
    useRoomStore.getState().setCursor({ x: 10, y: 20, userId: "member-1" });

    useRoomStore.getState().removeMember("member-1");

    expect(useRoomStore.getState().room?.members).toHaveLength(0);
    expect(useRoomStore.getState().cursors.has("member-1")).toBe(false);
  });

  it("sets and removes cursors", () => {
    useRoomStore.getState().setCursor({ x: 100, y: 200, userId: "user-1" });
    expect(useRoomStore.getState().cursors.get("user-1")).toEqual({
      x: 100,
      y: 200,
      userId: "user-1",
    });

    useRoomStore.getState().removeCursor("user-1");
    expect(useRoomStore.getState().cursors.has("user-1")).toBe(false);
  });

  it("toggles lock state", () => {
    useRoomStore.getState().setRoom(TEST_ROOM);

    useRoomStore.getState().setLocked(true);
    expect(useRoomStore.getState().room?.state).toBe("locked");

    useRoomStore.getState().setLocked(false);
    expect(useRoomStore.getState().room?.state).toBe("open");
  });

  it("resets to initial state", () => {
    useRoomStore.getState().setRoom(TEST_ROOM);
    useRoomStore.getState().setConnected(true);
    useRoomStore.getState().setCursor({ x: 1, y: 2, userId: "u" });

    useRoomStore.getState().reset();

    expect(useRoomStore.getState().room).toBeNull();
    expect(useRoomStore.getState().isConnected).toBe(false);
    expect(useRoomStore.getState().cursors.size).toBe(0);
  });
});
