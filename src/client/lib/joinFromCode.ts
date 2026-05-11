interface JoinFromCodeDeps {
  /** HTTP-flavored "open or join a room for this jar" (POST /api/rooms → socket join). */
  openRoomForJar: (jarId: string) => Promise<void> | void;
  /** Surface a user-visible error when the code doesn't resolve to a jar. */
  setError: (error: string | null) => void;
}

/**
 * Single entry point for "the user landed on /CODE, get them into a room."
 *
 * Codes in the URL are jar `share_code`s — the permanent per-jar identifier.
 * Resolves it, then opens-or-joins the active room on that jar via the
 * existing useJarActions.openRoomForJar path.
 *
 * Failure modes:
 *   - 404: not a valid share-code → error toast. Old `/<roomCode>` bookmarks
 *     from before the contract migration land here.
 *   - 403: jar exists but the visitor isn't on its allowlist → error toast.
 *   - Network failure → error toast.
 */
export function createJoinFromCode({ openRoomForJar, setError }: JoinFromCodeDeps) {
  return async (code: string, _displayName: string): Promise<void> => {
    try {
      const res = await fetch(`/api/jars/by-share-code/${code}`, { credentials: "include" });
      if (res.ok) {
        const jar = (await res.json()) as { id: string };
        await openRoomForJar(jar.id);
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
