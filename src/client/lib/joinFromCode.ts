interface JoinFromCodeDeps {
  /** Raw socket join — used when an active room already exists for the jar. */
  joinRoom: (roomId: string, displayName: string) => void;
  /** HTTP-flavored create-or-join (POST /api/rooms → socket join). Auth-gated. */
  openRoomForJar: (jarId: string) => Promise<void> | void;
  /** Surface a user-visible error when the code doesn't resolve or fails. */
  setError: (error: string | null) => void;
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
 *   - No active room → open one via POST /api/rooms (auth-gated). Anon
 *     users hit 401 here, which surfaces as a setError — the right answer:
 *     starting a new session requires sign-in.
 *
 * Failure modes:
 *   - 404: not a valid share-code → error toast. Old `/<roomCode>` bookmarks
 *     from before the contract migration land here.
 *   - 403: jar exists but the visitor isn't on its allowlist → error toast.
 *   - Network failure → error toast.
 */
export function createJoinFromCode({ joinRoom, openRoomForJar, setError }: JoinFromCodeDeps) {
  return async (code: string, displayName: string): Promise<void> => {
    try {
      const res = await fetch(`/api/jars/by-share-code/${code}`, { credentials: "include" });
      if (res.ok) {
        const jar = (await res.json()) as JarLookupResponse;
        if (jar.activeRoomId) {
          joinRoom(jar.activeRoomId, displayName);
        } else {
          await openRoomForJar(jar.id);
        }
        return;
      }
      if (res.status === 404) {
        setError("That link no longer works — the jar may have been deleted.");
      } else if (res.status === 403) {
        setError("You're not on this jar's allowlist. Ask the owner to invite you.");
      } else {
        setError("Couldn't open that link.");
      }
    } catch {
      setError("Couldn't reach the server — check your connection.");
    }
  };
}
