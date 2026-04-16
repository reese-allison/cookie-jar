import type { JarAppearance, JarConfig, Note, PullHistoryEntry } from "@shared/types";
import { create } from "zustand";

interface NoteStore {
  inJarCount: number;
  pulledNotes: Note[];
  pullCounts: Record<string, number>;
  jarConfig: JarConfig | null;
  jarAppearance: JarAppearance | null;
  history: PullHistoryEntry[];
  isAdding: boolean;
  isPulling: boolean;

  // Actions
  setNoteState: (
    inJarCount: number,
    pulledNotes: Note[],
    pullCounts?: Record<string, number>,
    jarConfig?: JarConfig,
    jarAppearance?: JarAppearance,
  ) => void;
  noteAdded: (note: Note, inJarCount: number) => void;
  notePulled: (note: Note) => void;
  noteDiscarded: (noteId: string) => void;
  noteReturned: (noteId: string, inJarCount: number) => void;
  setHistory: (entries: PullHistoryEntry[]) => void;
  setAdding: (adding: boolean) => void;
  setPulling: (pulling: boolean) => void;
  reset: () => void;
}

const initialState = {
  inJarCount: 0,
  pulledNotes: [] as Note[],
  pullCounts: {} as Record<string, number>,
  jarConfig: null as JarConfig | null,
  jarAppearance: null as JarAppearance | null,
  history: [] as PullHistoryEntry[],
  isAdding: false,
  isPulling: false,
};

export const useNoteStore = create<NoteStore>((set) => ({
  ...initialState,

  setNoteState: (inJarCount, pulledNotes, pullCounts, jarConfig, jarAppearance) =>
    set({
      inJarCount,
      pulledNotes,
      ...(pullCounts !== undefined ? { pullCounts } : {}),
      ...(jarConfig !== undefined ? { jarConfig } : {}),
      ...(jarAppearance !== undefined ? { jarAppearance } : {}),
    }),

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

  setHistory: (history) => set({ history }),
  setAdding: (isAdding) => set({ isAdding }),
  setPulling: (isPulling) => set({ isPulling }),
  reset: () => set(initialState),
}));
