import { type RefObject, useEffect } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Trap keyboard focus inside `containerRef` while `active` is true.
 *
 * On activation: focus moves to the first focusable child.
 * On Tab / Shift+Tab: focus wraps within the container.
 * On deactivation: focus returns to whatever element was focused
 * before the trap turned on.
 *
 * Keep the dependency on `active` and nothing else — if `containerRef` or the
 * focusable set changes during an open drawer we don't want to thrash focus.
 */
function findFocusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true",
  );
}

function handleTabWrap(e: KeyboardEvent, container: HTMLElement): void {
  const items = findFocusables(container);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const activeEl = document.activeElement as HTMLElement | null;
  const shouldWrapBack = e.shiftKey && (activeEl === first || !container.contains(activeEl));
  const shouldWrapForward = !e.shiftKey && (activeEl === last || !container.contains(activeEl));
  if (shouldWrapBack) {
    e.preventDefault();
    last.focus();
  } else if (shouldWrapForward) {
    e.preventDefault();
    first.focus();
  }
}

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    findFocusables(container)[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") handleTabWrap(e, container);
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
