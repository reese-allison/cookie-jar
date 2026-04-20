/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "../../../src/client/hooks/useMediaQuery";

type Listener = (e: { matches: boolean }) => void;

function makeMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  let matches = initial;
  const mql = {
    get matches() {
      return matches;
    },
    media: "",
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    // Legacy fallbacks — some browsers still use these
    addListener: (fn: Listener) => listeners.add(fn),
    removeListener: (fn: Listener) => listeners.delete(fn),
    dispatchEvent: () => false,
    onchange: null,
  };
  return {
    mql,
    setMatches(next: boolean) {
      matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
    listenerCount: () => listeners.size,
  };
}

describe("useMediaQuery", () => {
  let helper: ReturnType<typeof makeMatchMedia>;

  beforeEach(() => {
    helper = makeMatchMedia(false);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => helper.mql),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the initial match value", () => {
    helper = makeMatchMedia(true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => helper.mql),
    );
    const { result } = renderHook(() => useMediaQuery("(max-width: 640px)"));
    expect(result.current).toBe(true);
  });

  it("updates when the media query changes", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 640px)"));
    expect(result.current).toBe(false);
    act(() => helper.setMatches(true));
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useMediaQuery("(max-width: 640px)"));
    expect(helper.listenerCount()).toBe(1);
    unmount();
    expect(helper.listenerCount()).toBe(0);
  });

  it("returns false when matchMedia is unavailable (SSR)", () => {
    vi.unstubAllGlobals();
    // @ts-expect-error — simulate missing API
    globalThis.matchMedia = undefined;
    const { result } = renderHook(() => useMediaQuery("(max-width: 640px)"));
    expect(result.current).toBe(false);
  });
});
