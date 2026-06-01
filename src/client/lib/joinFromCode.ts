import { pathForRoom } from "./roomUrl";

interface JoinFromCodeDeps {
  /** Raw socket join — used when an active room already exists for the jar. */
  joinRoom: (roomId: string, displayName: string) => void;
  /** HTTP-flavored create-or-join (POST /api/rooms → socket join). Auth-gated. */
  openRoomForJar: (jarId: string) => Promise<void> | void;
  /** Surface a user-visible error when the code doesn't resolve or fails. */
  setError: (error: string | null) => void;
  /** Whether the current visitor has an authenticated session. */
  isAuthenticated: boolean;
  /** Open the sign-in modal (anon visitors who must auth to open a room). */
  requestSignIn: () => void;
}

interface JarLookupResponse {
  id: string;
  shareCode: string;
  /** UUID of the currently-open room for this jar, or null if none. */
  activeRoomId: string | null;
}

/**
 * Single entry point for "the user landed on /CODE, get them into a room."
 *
 * Codes in the URL are jar `share_code`s — the permanent per-jar identifier.
 *
 * Two paths after resolving the jar:
 *   - Active room exists → socket-join its UUID directly. Anon-safe
 *     (matches "Anonymous = view-only (prod)" — no HTTP write involved).
 *   - No active room + authed → open one via POST /api/rooms (auth-gated).
 *   - No active room + anonymous → opening a fresh room is auth-gated, so
 *     rather than firing a doomed POST that 401s into a bare error toast, we
 *     write the share-code into the URL (so AuthButtons' full-path callbackURL
 *     returns the now-signed-in user here to auto-join) and prompt sign-in.
 *
 * Failure modes:
 *   - 404: not a valid share-code → error toast. Old `/<roomCode>` bookmarks
 *     from before the contract migration land here.
 *   - 403: jar exists but the visitor isn't on its allowlist → error toast.
 *   - Network failure → error toast.
 */
function errorForStatus(status: number): string {
  if (status === 404) return "That link no longer works — the jar may have been deleted.";
  if (status === 403) return "You're not on this jar's allowlist. Ask the owner to invite you.";
  return "Couldn't open that link.";
}

export function createJoinFromCode({
  joinRoom,
  openRoomForJar,
  setError,
  isAuthenticated,
  requestSignIn,
}: JoinFromCodeDeps) {
  // Route a successfully-resolved jar to the right entry point.
  const enterJar = async (jar: JarLookupResponse, displayName: string): Promise<void> => {
    if (jar.activeRoomId) {
      joinRoom(jar.activeRoomId, displayName);
      return;
    }
    if (isAuthenticated) {
      await openRoomForJar(jar.id);
      return;
    }
    // Opening a fresh room requires auth. Stamp the canonical shareCode into
    // the URL so the OAuth round-trip lands back on this jar, then offer
    // sign-in instead of a dead-end 401.
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", pathForRoom(jar.shareCode));
    }
    requestSignIn();
  };

  return async (code: string, displayName: string): Promise<void> => {
    try {
      const res = await fetch(`/api/jars/by-share-code/${encodeURIComponent(code)}`, {
        credentials: "include",
      });
      if (res.ok) {
        await enterJar((await res.json()) as JarLookupResponse, displayName);
      } else {
        setError(errorForStatus(res.status));
      }
    } catch {
      setError("Couldn't reach the server — check your connection.");
    }
  };
}
