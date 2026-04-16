import type { CursorPosition, Room, RoomMember } from "@shared/types";
import { create } from "zustand";

interface RoomStore {
  // Room state (server-authoritative)
  room: Room | null;
  isConnected: boolean;
  isJoining: boolean;
  error: string | null;

  // Cursors (ephemeral, from broadcasts)
  cursors: Map<string, CursorPosition>;

  // Actions
  setRoom: (room: Room | null) => void;
  setConnected: (connected: boolean) => void;
  setJoining: (joining: boolean) => void;
  setError: (error: string | null) => void;
  addMember: (member: RoomMember) => void;
  removeMember: (memberId: string) => void;
  setCursor: (cursor: CursorPosition) => void;
  removeCursor: (userId: string) => void;
  setLocked: (locked: boolean) => void;
  reset: () => void;
}

const initialState = {
  room: null,
  isConnected: false,
  isJoining: false,
  error: null,
  cursors: new Map<string, CursorPosition>(),
};

export const useRoomStore = create<RoomStore>((set) => ({
  ...initialState,

  setRoom: (room) => set({ room, isJoining: false, error: null }),
  setConnected: (isConnected) => set({ isConnected }),
  setJoining: (isJoining) => set({ isJoining }),
  setError: (error) => set({ error, isJoining: false }),

  addMember: (member) =>
    set((state) => {
      if (!state.room) return state;
      return {
        room: {
          ...state.room,
          members: [...state.room.members, member],
        },
      };
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

  setLocked: (locked) =>
    set((state) => {
      if (!state.room) return state;
      return {
        room: {
          ...state.room,
          state: locked ? "locked" : "open",
        },
      };
    }),

  reset: () => set(initialState),
}));
