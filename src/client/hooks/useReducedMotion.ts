import { useEffect, useState } from "react";

/**
 * Returns true when the OS / browser is advertising "I'd like less motion."
 * Components that drive their own animations via react-spring or similar
 * should check this and swap to `immediate: true` so motion-sensitive users
 * don't get thrown off by drag snap-backs, peer-drag tracking, etc.
 *
 * The CSS-level rule in index.css already covers @keyframes and transitions;
 * this hook covers the JS-driven animation path.
 */
const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}
