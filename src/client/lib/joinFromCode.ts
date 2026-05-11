interface JoinFromCodeDeps {
  /** HTTP-flavored "open or join a room for this jar" (POST /api/rooms → socket join). */
  openRoomForJar: (jarId: string) => Promise<void> | void;
  /** Raw socket join by room code — used as a fallback for legacy room-code URLs. */
  joinRoom: (code: string, displayName: string) => void;
}

/**
 * Single entry point for "the user landed on /CODE, get them into a room."
 *
 * Tries the new share-code path first: `code` might be a `jars.share_code`
 * (the permanent per-jar URL identifier). If so, the server resolves it and
 * `openRoomForJar` opens-or-joins the active room on that jar — so a stale
 * link to a closed session reopens cleanly with no special UI.
 *
 * Falls back to the legacy `joinRoom(code, displayName)` socket path if:
 *   - 404: the code isn't a share-code → assume it's a legacy room code.
 *   - non-2xx (e.g. 403 allowlist miss): let the socket layer report the
 *     same error via `room:error` so we don't show two toasts.
 *   - network failure: better to try the socket path than hang silently.
 */
export function createJoinFromCode({ openRoomForJar, joinRoom }: JoinFromCodeDeps) {
  return async (code: string, displayName: string): Promise<void> => {
    try {
      const res = await fetch(`/api/jars/by-share-code/${code}`, { credentials: "include" });
      if (res.ok) {
        const jar = (await res.json()) as { id: string };
        await openRoomForJar(jar.id);
        return;
      }
    } catch {
      // fall through to legacy path
    }
    joinRoom(code, displayName);
  };
}
