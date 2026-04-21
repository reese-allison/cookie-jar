import { type RefObject, useEffect } from "react";
import { useFocusTrap } from "./useFocusTrap";

/**
 * Wire up the two pieces of chrome every modal drawer needs:
 *  - trap keyboard focus inside `containerRef` while `open` is true,
 *  - close the drawer when the user hits Escape.
 *
 * Doesn't render anything — each drawer keeps its own markup + CSS. This is
 * deliberately a hook rather than a wrapper component because MyJarsDrawer
 * and JarSettingsDrawer have different DOM shapes (scrim + aside vs. flex
 * container) that we don't want to force into a shared skeleton.
 */
export function useDrawer(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  useFocusTrap(containerRef, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}
