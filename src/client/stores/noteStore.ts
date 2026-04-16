import type { Note } from "@shared/types";
import { create } from "zustand";

interface NoteStore {
  inJarCount: number;
  pulledNotes: Note[];
  isAdding: boolean;
  isPulling: boolean;

  // Actions
  setNoteState: (inJarCount: number, pulledNotes: Note[]) => void;
  noteAdded: (note: Note, inJarCount: number) => void;
  notePulled: (note: Note) => void;
  noteDiscarded: (noteId: string) => void;
  noteReturned: (noteId: string, inJarCount: number) => void;
  setAdding: (adding: boolean) => void;
  setPulling: (pulling: boolean) => void;
  reset: () => void;
}

const initialState = {
  inJarCount: 0,
  pulledNotes: [] as Note[],
  isAdding: false,
  isPulling: false,
};

export const useNoteStore = create<NoteStore>((set) => ({
  ...initialState,

  setNoteState: (inJarCount, pulledNotes) => set({ inJarCount, pulledNotes }),

  noteAdded: (_note, inJarCount) => set({ inJarCount, isAdding: false }),

  notePulled: (note) =>
    set((state) => ({
      pulledNotes: [...state.pulledNotes, note],
      inJarCount: Math.max(0, state.inJarCount - 1),
      isPulling: false,
    })),

  noteDiscarded: (noteId) =>
    set((state) => ({
      pulledNotes: state.pulledNotes.filter((n) => n.id !== noteId),
    })),

  noteReturned: (noteId, inJarCount) =>
    set((state) => ({
      pulledNotes: state.pulledNotes.filter((n) => n.id !== noteId),
      inJarCount,
    })),

  setAdding: (isAdding) => set({ isAdding }),
  setPulling: (isPulling) => set({ isPulling }),
  reset: () => set(initialState),
}));
