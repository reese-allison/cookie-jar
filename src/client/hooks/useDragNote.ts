import { useSpring } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { useCallback, useRef, useState } from "react";
import { hitTestRect, type Rect } from "./hitTest";
import { useReducedMotion } from "./useReducedMotion";

export type DropTarget = "jar" | "discard" | null;

interface UseDragNoteOptions {
  onDrop: (target: DropTarget) => void;
  onDragStart?: () => void;
  onDragMove?: (hovering: DropTarget) => void;
  onDragPositionChange?: (mx: number, my: number) => void;
  onDragEnd?: () => void;
  jarRect: React.RefObject<Rect | null>;
  discardRect: React.RefObject<Rect | null>;
  enabled?: boolean;
}

export function useDragNote({
  onDrop,
  onDragStart,
  onDragMove,
  onDragPositionChange,
  onDragEnd,
  jarRect,
  discardRect,
  enabled = true,
}: UseDragNoteOptions) {
  const isDragging = useRef(false);
  const [isActive, setIsActive] = useState(false);
  const reduceMotion = useReducedMotion();

  const [style, api] = useSpring(() => ({
    x: 0,
    y: 0,
    rotate: 0,
    scale: 1,
    config: { tension: 300, friction: 20 },
  }));

  const getHoverTarget = useCallback(
    (x: number, y: number): DropTarget => {
      if (jarRect.current && hitTestRect(x, y, jarRect.current)) return "jar";
      if (discardRect.current && hitTestRect(x, y, discardRect.current)) return "discard";
      return null;
    },
    [jarRect, discardRect],
  );

  // Extract the "drag frame" update so the useDrag callback stays under the
  // noExcessiveCognitiveComplexity threshold. Rotation + scale are suppressed
  // in reduced-motion mode — the note still moves with the pointer, just
  // without extra wiggle or zoom.
  const applyActiveFrame = useCallback(
    (mx: number, my: number, vx: number, px: number, py: number) => {
      const rotation = reduceMotion ? 0 : Math.min(Math.max(vx * 4, -15), 15);
      const liftScale = reduceMotion ? 1 : 1.05;
      onDragMove?.(getHoverTarget(px, py));
      onDragPositionChange?.(mx, my);
      api.start({
        x: mx,
        y: my,
        rotate: rotation,
        scale: liftScale,
        immediate: reduceMotion ? true : (key: string) => key === "x" || key === "y",
      });
    },
    [reduceMotion, onDragMove, onDragPositionChange, getHoverTarget, api],
  );

  const applyDrop = useCallback(
    (px: number, py: number) => {
      isDragging.current = false;
      setIsActive(false);
      onDrop(getHoverTarget(px, py));
      onDragEnd?.();
      api.start({ x: 0, y: 0, rotate: 0, scale: 1, immediate: reduceMotion });
    },
    [onDrop, onDragEnd, getHoverTarget, api, reduceMotion],
  );

  const bind = useDrag(
    ({ active, movement: [mx, my], velocity: [vx], down, xy: [px, py], first, memo }) => {
      if (!enabled) return;
      if (first) {
        isDragging.current = true;
        setIsActive(true);
        onDragStart?.();
      }
      if (active) applyActiveFrame(mx, my, vx, px, py);
      if (!down && isDragging.current) applyDrop(px, py);
      return memo;
    },
    { filterTaps: true },
  );

  return { bind, style, isDragging: isActive };
}
