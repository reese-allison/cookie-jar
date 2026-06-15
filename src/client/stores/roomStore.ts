import type { CursorPosition, Room, RoomMember } from "@shared/types";
import { create } from "zustand";

interface RoomStore {
  // Room state (server-authoritative)
  room: Room | null;
  isConnected: boolean;
  isJoining: boolean;
  error: string | null;
  // Non-error, transient toast (e.g. "Copied!"). Kept separate from `error` so
  // success/info messages don't borrow the assertive error channel or its
  // join-flow side effects. Rendered by NoticeToast.
  notice: string | null;
  // Socket.io session id for this tab. Matches members[i].id and
  // disambiguates the current user from peers with the same display name.
  myId: string | null;

  // Cursors (ephemeral, from broadcasts)
  cursors: Map<string, CursorPosition>;

  // Actions
  setRoom: (room: Room | null) => void;
  setConnected: (connected: boolean) => void;
  setJoining: (joining: boolean) => void;
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  setMyId: (id: string | null) => void;
  addMember: (member: RoomMember) => void;
  removeMember: (memberId: string) => void;
  setCursor: (cursor: CursorPosition) => void;
  removeCursor: (userId: string) => void;
  reset: () => void;
}

const initialState = {
  room: null,
  isConnected: false,
  isJoining: false,
  error: null,
  notice: null as string | null,
  myId: null as string | null,
  cursors: new Map<string, CursorPosition>(),
};

export const useRoomStore = create<RoomStore>((set) => ({
  ...initialState,

  setRoom: (room) => set({ room, isJoining: false, error: null }),
  setConnected: (isConnected) => set({ isConnected }),
  setJoining: (isJoining) => set({ isJoining }),
  setError: (error) => set({ error, isJoining: false }),
  setNotice: (notice) => set({ notice }),
  setMyId: (myId) => set({ myId }),

  addMember: (member) =>
    set((state) => {
      if (!state.room) return state;
      // Upsert by id so a duplicate room:member_joined (e.g. a reconnect race
      // emits twice) doesn't render the same person twice in the roster.
      const existingIdx = state.room.members.findIndex((m) => m.id === member.id);
      const members =
        existingIdx === -1
          ? [...state.room.members, member]
          : state.room.members.map((m, i) => (i === existingIdx ? member : m));
      return { room: { ...state.room, members } };
    }),

  removeMember: (memberId) =>
    set((state) => {
      if (!state.room) return state;
      const cursors = new Map(state.cursors);
      cursors.delete(memberId);
      return {
        room: {
          ...state.room,
          members: state.room.members.filter((m) => m.id !== memberId),
        },
        cursors,
      };
    }),

  setCursor: (cursor) =>
    set((state) => {
      const cursors = new Map(state.cursors);
      cursors.set(cursor.userId, cursor);
      return { cursors };
    }),

  removeCursor: (userId) =>
    set((state) => {
      const cursors = new Map(state.cursors);
      cursors.delete(userId);
      return { cursors };
    }),

  reset: () => set({ ...initialState, cursors: new Map() }),
}));
