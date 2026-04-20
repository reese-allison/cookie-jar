/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "../../../src/client/hooks/useReducedMotion";

type Listener = (e: MediaQueryListEvent) => void;

interface FakeMql {
  matches: boolean;
  addEventListener: (evt: string, listener: Listener) => void;
  removeEventListener: (evt: string, listener: Listener) => void;
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  media?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  onchange?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  addListener?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  removeListener?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  dispatchEvent?: any;
}

function installMatchMedia(initialMatches: boolean) {
  let listener: Listener | null = null;
  const mql: FakeMql = {
    matches: initialMatches,
    addEventListener: (_evt, fn) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    trigger(newMatches: boolean) {
      mql.matches = newMatches;
      listener?.({ matches: newMatches } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: restoring jsdom default
  delete (window as any).matchMedia;
});

describe("useReducedMotion", () => {
  it("returns false when prefers-reduced-motion is not set", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when prefers-reduced-motion is set at mount", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the media query toggles", () => {
    const { trigger } = installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => trigger(true));
    expect(result.current).toBe(true);
    act(() => trigger(false));
    expect(result.current).toBe(false);
  });
});
