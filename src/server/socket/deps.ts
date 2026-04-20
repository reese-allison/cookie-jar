import type { CacheBus } from "./cacheBus";
import type { DedupStore } from "./dedupStore";
import type { KickBus } from "./kickBus";
import type { PresenceStore } from "./presenceStore";
import type { RoomStateCache } from "./roomStateCache";
import type { SealedNotesStore } from "./sealedNotesStore";

/**
 * Shared Redis-backed state accessed by multiple socket handlers. Constructed
 * once in buildSocketServer and threaded through registerXxxHandlers so
 * handlers stay easy to unit-test with fakes.
 */
export interface SocketDeps {
  sealedNotesStore: SealedNotesStore;
  dedupStore: DedupStore;
  kickBus: KickBus;
  cacheBus: CacheBus;
  presenceStore: PresenceStore;
  roomStateCache: RoomStateCache;
}
