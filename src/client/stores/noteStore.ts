import type { JarAppearance, JarConfig, Note, PullHistoryEntry } from "@shared/types";
import { create } from "zustand";

export interface PeerDrag {
  draggerId: string;
  mx: number;
  my: number;
}

interface NoteStore {
  inJarCount: number;
  pulledNotes: Note[];
  pullCounts: Record<string, number>;
  jarConfig: JarConfig | null;
  jarAppearance: JarAppearance | null;
  history: PullHistoryEntry[];
  sealedCount: number;
  sealedRevealAt: number;
  isAdding: boolean;
  isPulling: boolean;
  // noteId -> peer drag state. A note here is being dragged by someone else;
  // the current client should mirror the transform and disable its own drag.
  peerDrags: Map<string, PeerDrag>;

  // Actions
  setNoteState: (
    inJarCount: number,
    pulledNotes: Note[] | undefined,
    pullCounts?: Record<string, number>,
    jarConfig?: JarConfig,
    jarAppearance?: JarAppearance,
  ) => void;
  noteAdded: (note: Note, inJarCount: number) => void;
  notePulled: (note: Note) => void;
  noteDiscarded: (noteId: string) => void;
  noteReturned: (noteId: string, inJarCount: number) => void;
  noteSealed: (sealedCount: number, revealAt: number, inJarCount: number) => void;
  notesRevealed: (notes: Note[]) => void;
  setHistory: (entries: PullHistoryEntry[]) => void;
  setAdding: (adding: boolean) => void;
  setPulling: (pulling: boolean) => void;
  setPeerDrag: (noteId: string, drag: PeerDrag) => void;
  clearPeerDrag: (noteId: string) => void;
  clearPeerDragsByUser: (draggerId: string) => void;
  reset: () => void;
}

const initialState = {
  inJarCount: 0,
  pulledNotes: [] as Note[],
  pullCounts: {} as Record<string, number>,
  jarConfig: null as JarConfig | null,
  jarAppearance: null as JarAppearance | null,
  history: [] as PullHistoryEntry[],
  sealedCount: 0,
  sealedRevealAt: 0,
  isAdding: false,
  isPulling: false,
  peerDrags: new Map<string, PeerDrag>(),
};

export const useNoteStore = create<NoteStore>((set) => ({
  ...initialState,

  setNoteState: (inJarCount, pulledNotes, pullCounts, jarConfig, jarAppearance) =>
    set({
      inJarCount,
      ...(pulledNotes !== undefined ? { pulledNotes } : {}),
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

  noteSealed: (sealedCount, sealedRevealAt, inJarCount) =>
    set({ sealedCount, sealedRevealAt, inJarCount, isPulling: false }),

  notesRevealed: (notes) =>
    set((state) => ({
      pulledNotes: [...state.pulledNotes, ...notes],
      sealedCount: 0,
      sealedRevealAt: 0,
    })),

  setHistory: (history) => set({ history }),
  setAdding: (isAdding) => set({ isAdding }),
  setPulling: (isPulling) => set({ isPulling }),
  setPeerDrag: (noteId, drag) =>
    set((state) => {
      const peerDrags = new Map(state.peerDrags);
      peerDrags.set(noteId, drag);
      return { peerDrags };
    }),
  clearPeerDrag: (noteId) =>
    set((state) => {
      if (!state.peerDrags.has(noteId)) return state;
      const peerDrags = new Map(state.peerDrags);
      peerDrags.delete(noteId);
      return { peerDrags };
    }),
  clearPeerDragsByUser: (draggerId) =>
    set((state) => {
      const peerDrags = new Map(state.peerDrags);
      let changed = false;
      for (const [noteId, drag] of peerDrags) {
        if (drag.draggerId === draggerId) {
          peerDrags.delete(noteId);
          changed = true;
        }
      }
      return changed ? { peerDrags } : state;
    }),
  reset: () => set({ ...initialState, peerDrags: new Map() }),
}));
