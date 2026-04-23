import pool from "../db/pool";
import * as noteQueries from "../db/queries/notes";
import type { SocketDeps } from "./deps";
import { fireAndForget } from "./fireAndForget";

/**
 * Cleanup actions that follow a successful room close: bring pulled notes
 * back into the jar, and drop per-room Redis state (presence + sealed
 * buffer). Callers should have already flipped `rooms.state` to `closed`
 * via `closeRoomIfOpen` so this only runs on the winner of a close race.
 *
 * Shared across:
 *   - last-leave grace timer (lastLeaveGrace.ts)
 *   - idle-timeout close (roomHelpers.ts)
 *
 * The owner-deletes-jar path (broadcaster.ts `disconnectJarRooms`) skips
 * the note-reset because FK cascade from `jars` will delete those rows, and
 * skips the Redis clear because each socket's `handleLeave` does it. It
 * stays on its own bespoke path.
 */
export async function closeEmptyRoom(
  deps: SocketDeps,
  roomId: string,
  jarId: string | null,
): Promise<void> {
  if (jarId) {
    fireAndForget(
      noteQueries.resetPulledNotesForJar(pool, jarId),
      "closeEmptyRoom.resetPulledNotesForJar",
    );
  }
  fireAndForget(deps.presenceStore.clearRoom(roomId), "closeEmptyRoom.clearRoom");
  fireAndForget(deps.sealedNotesStore.clear(roomId), "closeEmptyRoom.sealedNotesStore.clear");
}
