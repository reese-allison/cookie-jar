import { useSpring } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { useCallback, useRef } from "react";
import { hitTestRect, type Rect } from "./hitTest";

export type DropTarget = "jar" | "discard" | null;

interface UseDragNoteOptions {
  onDrop: (target: DropTarget) => void;
  onDragStart?: () => void;
  onDragMove?: (hovering: DropTarget) => void;
  jarRect: React.RefObject<Rect | null>;
  discardRect: React.RefObject<Rect | null>;
  enabled?: boolean;
}

export function useDragNote({
  onDrop,
  onDragStart,
  onDragMove,
  jarRect,
  discardRect,
  enabled = true,
}: UseDragNoteOptions) {
  const isDragging = useRef(false);

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

  const bind = useDrag(
    ({ active, movement: [mx, my], velocity: [vx], down, xy: [px, py], first, memo }) => {
      if (!enabled) return;

      if (first) {
        isDragging.current = true;
        onDragStart?.();
      }

      // Rotation based on horizontal velocity (capped)
      const rotation = active ? Math.min(Math.max(vx * 4, -15), 15) : 0;

      if (active) {
        const hoverTarget = getHoverTarget(px, py);
        onDragMove?.(hoverTarget);

        api.start({
          x: mx,
          y: my,
          rotate: rotation,
          scale: 1.05,
          immediate: (key: string) => key === "x" || key === "y",
        });
      }

      if (!down && isDragging.current) {
        isDragging.current = false;
        const dropTarget = getHoverTarget(px, py);
        onDrop(dropTarget);

        // Snap back to origin
        api.start({
          x: 0,
          y: 0,
          rotate: 0,
          scale: 1,
        });
      }

      return memo;
    },
    {
      filterTaps: true,
    },
  );

  return { bind, style, isDragging: isDragging.current };
}
