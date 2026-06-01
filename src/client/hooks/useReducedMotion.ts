import { useMediaQuery } from "./useMediaQuery";

/**
 * Returns true when the OS / browser is advertising "I'd like less motion."
 * Components that drive their own animations via react-spring or similar
 * should check this and swap to `immediate: true` so motion-sensitive users
 * don't get thrown off by drag snap-backs, peer-drag tracking, etc.
 *
 * The CSS-level rule in index.css already covers @keyframes and transitions;
 * this hook covers the JS-driven animation path. Thin wrapper over
 * useMediaQuery so the matchMedia subscribe/cleanup logic lives in one place.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
