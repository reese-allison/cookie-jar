/**
 * @vitest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNoteStore } from "../../../src/client/stores/noteStore";
import { useRoomStore } from "../../../src/client/stores/roomStore";

beforeEach(() => {
  useRoomStore.getState().reset();
  useNoteStore.getState().reset();
});

describe("narrow selectors", () => {
  it("subscribing to room does NOT re-render on cursor changes", () => {
    const spy = vi.fn();
    function Consumer() {
      useRoomStore((s) => s.room);
      spy();
      return null;
    }
    render(<Consumer />);
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => {
      useRoomStore.getState().setCursor({ userId: "u1", x: 1, y: 1 });
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("subscribing to cursors DOES re-render on cursor changes", () => {
    const spy = vi.fn();
    function Consumer() {
      useRoomStore((s) => s.cursors);
      spy();
      return null;
    }
    render(<Consumer />);

    act(() => {
      useRoomStore.getState().setCursor({ userId: "u1", x: 1, y: 1 });
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("subscribing to inJarCount does NOT re-render on cursor changes", () => {
    const spy = vi.fn();
    function Consumer() {
      useNoteStore((s) => s.inJarCount);
      spy();
      return null;
    }
    render(<Consumer />);

    act(() => {
      useRoomStore.getState().setCursor({ userId: "u1", x: 1, y: 1 });
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
