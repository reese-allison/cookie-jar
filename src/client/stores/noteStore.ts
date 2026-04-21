import type {
  JarAppearance,
  JarConfig,
  Note,
  NoteStatePayload,
  PullHistoryEntry,
} from "@shared/types";
import { create } from "zustand";

export interface PeerDrag {
  draggerId: string;
  mx: number;
  my: number;
}

interface NoteStore {
  inJarCount: number;
  pulledNotes: Note[];
  jarName: string | null;
  jarConfig: JarConfig | null;
  jarAppearance: JarAppearance | null;
  history: PullHistoryEntry[];
  /**
   * True when a pull or reveal happened since the last successful history
   * fetch. PullHistory reads this to skip re-fetches that would return the
   * same rows (and, because the server rate-limits history:get to once per
   * 5 s, would otherwise trip a noisy rate_limited error for a pure UI open).
   */
  historyDirty: boolean;
  sealedCount: number;
  sealedRevealAt: number;
  /**
   * Whether the viewer has the current jar starred. Seeded from the server's
   * note:state on join and mutated locally when the user toggles the star.
   * Always false for owners (they don't star their own jars).
   */
  isStarred: boolean;
  isAdding: boolean;
  isPulling: boolean;
  // noteId -> peer drag state. A note here is being dragged by someone else;
  // the current client should mirror the transform and disable its own drag.
  peerDrags: Map<string, PeerDrag>;

  // Actions
  setNoteState: (payload: NoteStatePayload) => void;
  noteAdded: (note: Note, inJarCount: number) => void;
  notePulled: (note: Note) => void;
  noteDiscarded: (noteId: string) => void;
  noteReturned: (noteId: string, inJarCount: number) => void;
  /** Upsert a single note into pulledNotes by id. If its state is no longer "pulled", remove it. */
  noteUpdated: (note: Note) => void;
  noteSealed: (sealedCount: number, revealAt: number, inJarCount: number) => void;
  notesRevealed: (notes: Note[]) => void;
  setHistory: (entries: PullHistoryEntry[]) => void;
  markHistoryDirty: () => void;
  setStarred: (starred: boolean) => void;
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
  jarName: null as string | null,
  jarConfig: null as JarConfig | null,
  jarAppearance: null as JarAppearance | null,
  history: [] as PullHistoryEntry[],
  // True on first load so the initial open fetches; flipped on each pull/
  // reveal so subsequent opens only hit the wire when there's new data.
  historyDirty: true,
  sealedCount: 0,
  sealedRevealAt: 0,
  isStarred: false,
  isAdding: false,
  isPulling: false,
  peerDrags: new Map<string, PeerDrag>(),
};

export const useNoteStore = create<NoteStore>((set) => ({
  ...initialState,

  // Merge rule: server can omit any field ("count-only" delta). We overwrite
  // fields that are present, preserve fields that aren't. pulledNotes in
  // particular is an authoritative full list when sent, never partial — use
  // noteUpdated for single-note upserts.
  setNoteState: (payload) =>
    set({
      inJarCount: payload.inJarCount,
      ...(payload.pulledNotes !== undefined ? { pulledNotes: payload.pulledNotes } : {}),
      ...(payload.jarName !== undefined ? { jarName: payload.jarName } : {}),
      ...(payload.jarConfig !== undefined ? { jarConfig: payload.jarConfig } : {}),
      ...(payload.jarAppearance !== undefined ? { jarAppearance: payload.jarAppearance } : {}),
      ...(payload.sealedCount !== undefined ? { sealedCount: payload.sealedCount } : {}),
      ...(payload.sealedRevealAt !== undefined ? { sealedRevealAt: payload.sealedRevealAt } : {}),
      ...(payload.isStarred !== undefined ? { isStarred: payload.isStarred } : {}),
    }),

  noteAdded: (_note, inJarCount) => set({ inJarCount, isAdding: false }),

  notePulled: (note) =>
    set((state) => ({
      pulledNotes: [...state.pulledNotes, note],
      inJarCount: Math.max(0, state.inJarCount - 1),
      isPulling: false,
      historyDirty: true,
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

  noteUpdated: (note) =>
    set((state) => {
      const existing = state.pulledNotes.findIndex((n) => n.id === note.id);
      if (note.state !== "pulled") {
        return existing === -1
          ? state
          : { pulledNotes: state.pulledNotes.filter((n) => n.id !== note.id) };
      }
      if (existing === -1) return { pulledNotes: [...state.pulledNotes, note] };
      const next = state.pulledNotes.slice();
      next[existing] = note;
      return { pulledNotes: next };
    }),

  noteSealed: (sealedCount, sealedRevealAt, inJarCount) =>
    set({ sealedCount, sealedRevealAt, inJarCount, isPulling: false }),

  notesRevealed: (notes) =>
    set((state) => ({
      pulledNotes: [...state.pulledNotes, ...notes],
      sealedCount: 0,
      sealedRevealAt: 0,
      historyDirty: true,
    })),

  // Received history is the authoritative current state — clear the dirty
  // flag so we don't re-fetch on the next open until something changes.
  setHistory: (history) => set({ history, historyDirty: false }),
  markHistoryDirty: () => set({ historyDirty: true }),
  setStarred: (isStarred) => set({ isStarred }),
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
