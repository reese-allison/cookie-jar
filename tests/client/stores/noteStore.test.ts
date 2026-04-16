/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useNoteStore } from "../../../src/client/stores/noteStore";
import type { Note } from "../../../src/shared/types";

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: "note-1",
  jarId: "jar-1",
  text: "Test note",
  style: "sticky",
  state: "pulled",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  useNoteStore.getState().reset();
});

describe("noteStore", () => {
  it("sets initial note state on room join", () => {
    const pulled = [makeNote({ id: "n1" }), makeNote({ id: "n2" })];
    useNoteStore.getState().setNoteState(5, pulled);

    expect(useNoteStore.getState().inJarCount).toBe(5);
    expect(useNoteStore.getState().pulledNotes).toHaveLength(2);
  });

  it("increments count when a note is added", () => {
    useNoteStore.getState().setNoteState(3, []);
    useNoteStore.getState().noteAdded(makeNote({ state: "in_jar" }), 4);

    expect(useNoteStore.getState().inJarCount).toBe(4);
    expect(useNoteStore.getState().isAdding).toBe(false);
  });

  it("moves a note from jar to pulled list on pull", () => {
    useNoteStore.getState().setNoteState(3, []);
    useNoteStore.getState().notePulled(makeNote({ id: "pulled-1" }));

    expect(useNoteStore.getState().inJarCount).toBe(2);
    expect(useNoteStore.getState().pulledNotes).toHaveLength(1);
    expect(useNoteStore.getState().pulledNotes[0].id).toBe("pulled-1");
    expect(useNoteStore.getState().isPulling).toBe(false);
  });

  it("removes a note from pulled list on discard", () => {
    const pulled = [makeNote({ id: "n1" }), makeNote({ id: "n2" })];
    useNoteStore.getState().setNoteState(0, pulled);
    useNoteStore.getState().noteDiscarded("n1");

    expect(useNoteStore.getState().pulledNotes).toHaveLength(1);
    expect(useNoteStore.getState().pulledNotes[0].id).toBe("n2");
  });

  it("removes note from pulled and updates count on return", () => {
    const pulled = [makeNote({ id: "n1" })];
    useNoteStore.getState().setNoteState(2, pulled);
    useNoteStore.getState().noteReturned("n1", 3);

    expect(useNoteStore.getState().pulledNotes).toHaveLength(0);
    expect(useNoteStore.getState().inJarCount).toBe(3);
  });

  it("resets to initial state", () => {
    useNoteStore.getState().setNoteState(10, [makeNote()]);
    useNoteStore.getState().reset();

    expect(useNoteStore.getState().inJarCount).toBe(0);
    expect(useNoteStore.getState().pulledNotes).toHaveLength(0);
  });
});
