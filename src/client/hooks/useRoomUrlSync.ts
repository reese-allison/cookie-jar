import { useEffect, useRef, useState } from "react";
import { parseCodeFromPath, pathForRoom } from "../lib/roomUrl";
import { useRoomStore } from "../stores/roomStore";

interface UseRoomUrlSyncOptions {
  joinRoom: (code: string, displayName: string) => void;
  leaveRoom: () => void;
  displayName: string;
  /**
   * Gates the one-shot auto-join on mount and any popstate-driven join.
   * False on the unauthenticated landing so we prefill the form instead of
   * silently joining as "Guest" — the user should pick their own name first.
   */
  canAutoJoin: boolean;
}

/**
 * Keeps `window.location.pathname` in sync with `roomStore.room`:
 *   - On mount, if the URL looks like `/CODE`, return it as `initialCode` and
 *     auto-join when `canAutoJoin` is true.
 *   - When the room's `code` changes in the store (join/leave), pushState
 *     the matching URL. This gives users a stable, refresh-safe URL and
 *     mitigates the mobile-browser "tab sleep kicks you home" problem — the
 *     tab now has a real address to wake up on.
 *   - On popstate (back/forward), diff URL vs store and call joinRoom or
 *     leaveRoom to match.
 */
export function useRoomUrlSync({
  joinRoom,
  leaveRoom,
  displayName,
  canAutoJoin,
}: UseRoomUrlSyncOptions): string | null {
  const room = useRoomStore((s) => s.room);

  // Snapshot the URL once at mount so re-renders from a URL pushState don't
  // keep reporting a "new" initialCode to the caller.
  const [initialCode] = useState<string | null>(() =>
    typeof window === "undefined" ? null : parseCodeFromPath(window.location.pathname),
  );

  // One-shot auto-join on mount. A ref (not a hook dep) keeps this from
  // re-firing if `canAutoJoin` flips true later — by then the user has moved
  // on to the landing form and we don't want to yank them into the URL's
  // room behind their back.
  const didAutoJoin = useRef(false);
  useEffect(() => {
    if (didAutoJoin.current) return;
    if (!initialCode || !canAutoJoin) return;
    didAutoJoin.current = true;
    joinRoom(initialCode, displayName);
  }, [initialCode, canAutoJoin, joinRoom, displayName]);

  // Room → URL. pushState only when the pathname actually disagrees so we
  // don't spam the history stack on re-renders. The first run is skipped on
  // purpose — on mount `room` is always null, and if we pushed then we'd
  // clobber a `/CODE` URL back to `/` before the auto-join effect below has a
  // chance to read it.
  const currentCode = room?.code ?? null;
  const didMountRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const expected = pathForRoom(currentCode);
    if (window.location.pathname !== expected) {
      window.history.pushState({}, "", expected);
    }
  }, [currentCode]);

  // popstate → join/leave. Read the store via `.getState()` so we don't need
  // to re-bind the listener every time `room` changes — one attach/detach per
  // hook lifetime keeps the stack tidy.
  useEffect(() => {
    const handler = () => {
      const nextCode = parseCodeFromPath(window.location.pathname);
      const currentRoomCode = useRoomStore.getState().room?.code ?? null;
      if (nextCode && nextCode !== currentRoomCode) {
        if (canAutoJoin) joinRoom(nextCode, displayName);
      } else if (!nextCode && currentRoomCode) {
        leaveRoom();
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [joinRoom, leaveRoom, displayName, canAutoJoin]);

  return initialCode;
}
