/**
 * @vitest-environment jsdom
 *
 * Surface-only test: the gesture-pipeline behaviour (`useDrag` from
 * @use-gesture/react + `useSpring` animation) doesn't run reliably under
 * jsdom — pointer events aren't fully implemented and the spring loop
 * doesn't tick in a microtask. The full drag-and-drop flow is covered by
 * `RoomView.touchDrag.test.tsx` and the Playwright e2e suite. Here we just
 * verify the hook returns the expected shape, doesn't throw under different
 * option combinations, and exposes a stable `isDragging` initial state.
 */
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Rect } from "../../../src/client/hooks/hitTest";
import { useDragNote } from "../../../src/client/hooks/useDragNote";

afterEach(cleanup);

interface ProbeProps {
  enabled?: boolean;
  jarRect?: Rect | null;
  discardRect?: Rect | null;
  capture: (value: ReturnType<typeof useDragNote>) => void;
}

function Probe({ enabled, jarRect = null, discardRect = null, capture }: ProbeProps) {
  const jarRef = useRef<Rect | null>(jarRect);
  const discardRef = useRef<Rect | null>(discardRect);
  const out = useDragNote({
    onDrop: vi.fn(),
    jarRect: jarRef,
    discardRect: discardRef,
    enabled,
  });
  capture(out);
  return <div {...out.bind()} />;
}

function captureFromHook(props: Omit<ProbeProps, "capture"> = {}) {
  let captured!: ReturnType<typeof useDragNote>;
  render(<Probe {...props} capture={(v) => (captured = v)} />);
  return captured;
}

describe("useDragNote", () => {
  it("returns bind / style / isDragging", () => {
    const out = captureFromHook();
    expect(typeof out.bind).toBe("function");
    expect(out.style).toBeDefined();
    expect(out.isDragging).toBe(false);
  });

  it("isDragging starts false", () => {
    const out = captureFromHook();
    expect(out.isDragging).toBe(false);
  });

  it("bind() returns props that can be spread on a host element", () => {
    // The component above already renders <div {...bind()}> — if this throws
    // or React rejects the props (e.g. non-event-handler shape), the render
    // would have failed. This is a sanity check on the bind contract.
    const out = captureFromHook();
    const props = out.bind();
    expect(props).toBeTypeOf("object");
  });

  it("does not throw when constructed with enabled=false", () => {
    expect(() => captureFromHook({ enabled: false })).not.toThrow();
  });

  it("does not throw when jar and discard rects are null (pre-layout)", () => {
    expect(() => captureFromHook({ jarRect: null, discardRect: null })).not.toThrow();
  });
});
