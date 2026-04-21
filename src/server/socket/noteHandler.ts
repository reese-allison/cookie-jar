import { MAX_NOTES_PER_JAR } from "@shared/constants";
import type { ClientToServerEvents, Note, ServerToClientEvents } from "@shared/types";
import { parseNoteInput } from "@shared/validation";
import type { Socket } from "socket.io";
import pool from "../db/pool";
import * as noteQueries from "../db/queries/notes";
import * as pullHistoryQueries from "../db/queries/pullHistory";
import { withTransaction } from "../db/transaction";
import type { SocketContext } from "./context";
import type { SocketDeps } from "./deps";
import { withErrorHandler } from "./errorHandler";
import { fireAndForget } from "./fireAndForget";
import type { IdleTimeoutManager } from "./idleTimeout";
import { socketRateLimiter } from "./rateLimit";
import { isPullMine } from "./roomHelpers";
import type { TypedServer } from "./server";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function requireContributor(ctx: SocketContext, socket: TypedSocket): boolean {
  if (!ctx.isAuthenticated || ctx.role === "viewer") {
    socket.emit("room:error", "Sign in to participate");
    return false;
  }
  return true;
}

/**
 * Lock state is a jar-config field (`jarConfig.locked`). The per-pod jar
 * cache is invalidated on `jar:refresh`, so a toggle from the owner's
 * settings drawer takes effect immediately on this pod and within the TTL
 * elsewhere.
 */
async function isRoomLocked(ctx: SocketContext, deps: SocketDeps): Promise<boolean> {
  if (!ctx.jarId) return false;
  const { config } = await deps.roomStateCache.getJar(ctx.jarId);
  return config?.locked === true;
}

export function registerNoteHandlers(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
  deps: SocketDeps,
  idleTimeouts?: IdleTimeoutManager,
): void {
  // biome-ignore lint/suspicious/noExplicitAny: socket handlers have varied signatures
  const safe = (handler: (...args: any[]) => unknown) => withErrorHandler(socket, handler);

  function guardRate(event: string): boolean {
    if (!socketRateLimiter.allow(socket.id, event)) {
      // retryInMs is a hint for the client UI; 1 s is conservative for all
      // configured buckets (slowest is jar:refresh at 3 s, fastest note:* at
      // 500 ms). Clients can choose to honor or ignore it.
      socket.emit("rate_limited", event, 1000);
      return false;
    }
    return true;
  }

  /**
   * Rate-limit + require (roomId, jarId, contributor role) before letting the
   * handler body run. Optionally also reject when the room is locked. Returns
   * a narrowed `{ roomId, jarId }` on success or null when any guard fails —
   * every failure has already emitted the appropriate error/rate_limited
   * event to the caller. Keeping this in one place means adding a new guard
   * (e.g. "jar exists") only touches one line.
   */
  async function enterContributor(
    event: string,
    opts: { lockedError?: string } = {},
  ): Promise<{ roomId: string; jarId: string } | null> {
    if (!guardRate(event)) return null;
    if (!ctx.roomId || !ctx.jarId) return null;
    if (!requireContributor(ctx, socket)) return null;
    if (opts.lockedError !== undefined && (await isRoomLocked(ctx, deps))) {
      socket.emit("room:error", opts.lockedError);
      return null;
    }
    // Every contributor action counts as activity — without this, a mobile
    // user (no mouse = no cursor:move) actively pulling and adding notes
    // would still idle-close.
    idleTimeouts?.resetActivity(ctx.roomId);
    return { roomId: ctx.roomId, jarId: ctx.jarId };
  }

  /**
   * Same shape as enterContributor but requires the owner role. Used by bulk
   * ops and any other action that's gated to the room's host.
   */
  function enterOwner(
    event: string,
    denyMessage: string,
  ): { roomId: string; jarId: string } | null {
    if (!guardRate(event)) return null;
    if (!ctx.roomId || !ctx.jarId) return null;
    if (ctx.role !== "owner") {
      socket.emit("room:error", denyMessage);
      return null;
    }
    idleTimeouts?.resetActivity(ctx.roomId);
    return { roomId: ctx.roomId, jarId: ctx.jarId };
  }

  socket.on(
    "note:add",
    safe(async (noteInput: unknown) => {
      const entry = await enterContributor("note:add", {
        lockedError: "The jar is locked — no new notes can be added",
      });
      if (!entry) return;
      const { roomId, jarId } = entry;

      const parsed = parseNoteInput(noteInput);
      if (!parsed.ok) {
        socket.emit("room:error", parsed.error);
        return;
      }
      const { note: validated } = parsed;

      // Atomic cap check — serialized per-jar via pg_advisory_xact_lock so
      // two concurrent sockets can't each see count = MAX-1 and both insert.
      const note = await noteQueries.createNoteIfUnderCap(
        pool,
        {
          jarId,
          text: validated.text,
          url: validated.url,
          style: validated.style,
          authorId: ctx.userId ?? undefined,
        },
        MAX_NOTES_PER_JAR,
      );
      if (!note) {
        socket.emit("room:error", `Jar is full (${MAX_NOTES_PER_JAR} notes max)`);
        return;
      }
      // Send the authoritative post-insert count — cheaper than a second
      // COUNT(*) because we can derive it from the advisory-locked
      // transaction that just ran. Clients rely on this to update the jar
      // label.
      const inJarCount = await noteQueries.countNotesByState(pool, jarId, "in_jar");
      io.to(roomId).emit("note:added", note, inJarCount);
    }),
  );

  socket.on(
    "note:pull",
    safe(async () => {
      const entry = await enterContributor("note:pull");
      if (!entry) return;
      const { roomId, jarId } = entry;

      const pulledBy = ctx.displayName ?? ctx.memberId ?? socket.id;
      const note = await commitPull(jarId, roomId, pulledBy, ctx.userId ?? undefined);
      if (!note) {
        socket.emit("pull:rejected", "The jar is empty");
        return;
      }
      await fanOutPull(io, socket, ctx, deps, note, pulledBy);
    }),
  );

  socket.on(
    "note:discard",
    safe(async (noteId: string) => {
      const entry = await enterContributor("note:discard", {
        lockedError: "The jar is locked — notes can't be discarded",
      });
      if (!entry) return;
      const { roomId, jarId } = entry;

      // Discard only acts on a note that's currently on the table (pulled).
      // Without this state filter, a contributor could "discard" an already-
      // in-jar or already-discarded note and force a bogus broadcast.
      const updated = await noteQueries.updateNoteStateIfInJar(
        pool,
        noteId,
        jarId,
        "discarded",
        "pulled",
      );
      if (!updated) return;

      // If the note was sitting in the sealed buffer waiting for reveal,
      // drop it now — otherwise it'd materialize on the table when the
      // threshold fires, even though it's already been discarded.
      fireAndForget(
        deps.sealedNotesStore.remove(roomId, noteId),
        "sealedNotesStore.remove(discard)",
      );

      io.to(roomId).emit("note:discarded", noteId);
    }),
  );

  socket.on(
    "note:return",
    safe(async (noteId: string) => {
      const entry = await enterContributor("note:return");
      if (!entry) return;
      const { roomId, jarId } = entry;

      // Return only acts on a pulled note. Crucial: without the source-state
      // filter a contributor could call note:return on a discarded note and
      // resurrect it into the jar, undoing the discard permanently.
      const updated = await noteQueries.updateNoteStateIfInJar(
        pool,
        noteId,
        jarId,
        "in_jar",
        "pulled",
      );
      if (!updated) return;

      const inJarCount = await noteQueries.countNotesByState(pool, jarId, "in_jar");
      io.to(roomId).emit("note:returned", noteId, inJarCount);
    }),
  );

  // Owner-only bulk ops. "Return all" flips every pulled note back into the
  // jar; "Discard all" burns them. Both emit per-note broadcasts so client
  // stores track the transitions the same way they would for a single event.
  socket.on(
    "note:returnAll",
    safe(async () => {
      const entry = enterOwner("note:returnAll", "Only the jar owner can return every note");
      if (!entry) return;
      const { roomId, jarId } = entry;
      const ids = await noteQueries.bulkTransitionPulled(pool, jarId, "in_jar");
      if (ids.length === 0) return;
      const inJarCount = await noteQueries.countNotesByState(pool, jarId, "in_jar");
      for (const id of ids) io.to(roomId).emit("note:returned", id, inJarCount);
    }),
  );

  socket.on(
    "note:discardAll",
    safe(async () => {
      const entry = enterOwner("note:discardAll", "Only the jar owner can discard every note");
      if (!entry) return;
      const { roomId, jarId } = entry;
      const ids = await noteQueries.bulkTransitionPulled(pool, jarId, "discarded");
      for (const id of ids) io.to(roomId).emit("note:discarded", id);
    }),
  );

  // Ephemeral drag position broadcasts. No DB state — just relayed to peers so
  // the group sees the note moving in real time. Volatile for move updates
  // (drop intermediate packets if client is slow) so buffering can't build up.
  // Silent rate-drop: same reasoning as cursor:move — best-effort stream.
  socket.on("note:drag", (noteId, mx, my) => {
    if (!ctx.roomId) return;
    if (!socketRateLimiter.allow(socket.id, "note:drag")) return;
    // Same validation concern as cursor:move — a crafted client can send
    // non-string noteId or non-number coords. Broadcasting junk breaks peer
    // rendering (peerDrags.set keyed by a bogus value, NaN coords, etc.).
    if (
      typeof noteId !== "string" ||
      noteId.length === 0 ||
      noteId.length > 64 ||
      typeof mx !== "number" ||
      typeof my !== "number" ||
      !Number.isFinite(mx) ||
      !Number.isFinite(my)
    ) {
      return;
    }
    socket.volatile.to(ctx.roomId).emit("note:drag", noteId, socket.id, mx, my);
  });

  socket.on("note:drag_end", (noteId) => {
    if (!ctx.roomId) return;
    if (!socketRateLimiter.allow(socket.id, "note:drag_end")) return;
    if (typeof noteId !== "string" || noteId.length === 0 || noteId.length > 64) return;
    socket.to(ctx.roomId).emit("note:drag_end", noteId, socket.id);
  });

  socket.on(
    "history:get",
    safe(async () => {
      if (!guardRate("history:get")) return;
      if (!ctx.jarId) return;
      const entries = await pullHistoryQueries.getHistory(pool, ctx.jarId);
      const { config } = await deps.roomStateCache.getJar(ctx.jarId);
      const isPrivate = config?.pullVisibility === "private";
      // Owners don't get a privileged view in private mode — "Private hides
      // pulled notes from other members" means everyone, including the host.
      const viewer = { userId: ctx.userId, displayName: ctx.displayName };
      const filtered = isPrivate ? entries.filter((e) => isPullMine(e, viewer)) : entries;
      socket.emit(
        "history:list",
        filtered.map((e) => ({
          id: e.id,
          noteText: e.noteText,
          pulledBy: e.pulledBy,
          pulledAt: e.pulledAt,
        })),
      );
    }),
  );

  socket.on(
    "history:clear",
    safe(async () => {
      if (!ctx.jarId || !ctx.roomId || !ctx.isAuthenticated) return;
      if (ctx.role !== "owner") {
        socket.emit("room:error", "Only the jar owner can clear history");
        return;
      }
      await pullHistoryQueries.clearHistory(pool, ctx.jarId);
      // Broadcast to the whole room — history lives at the jar level in the
      // DB, so clearing is a global act. Peers with the history panel open
      // would otherwise keep rendering stale entries until the next refetch.
      io.to(ctx.roomId).emit("history:list", []);
    }),
  );
}

/**
 * Run the pull + history insert in a single transaction. Returns the pulled
 * note or null if the jar was empty. Factored out of the socket handler so
 * the event handler stays under the cognitive-complexity limit.
 */
async function commitPull(
  jarId: string,
  roomId: string,
  pulledBy: string,
  pulledByUserId?: string,
): Promise<Note | null> {
  return withTransaction(pool, async (client) => {
    const pulled = await noteQueries.pullRandomNote(client, jarId, pulledBy, pulledByUserId);
    if (!pulled) return null;
    await pullHistoryQueries.recordPull(client, {
      jarId,
      noteId: pulled.id,
      pulledBy,
      pulledByUserId,
      roomId,
    });
    return pulled;
  });
}

/**
 * Decide how to broadcast a just-pulled note based on the jar's current
 * visibility settings. Reads live config from the pod cache so mid-session
 * jar:refresh changes take effect before the next pull fans out.
 */
async function fanOutPull(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
  deps: SocketDeps,
  note: Note,
  pulledBy: string,
): Promise<void> {
  if (!ctx.roomId || !ctx.jarId) return;
  const { config: liveConfig } = await deps.roomStateCache.getJar(ctx.jarId);
  if (liveConfig?.noteVisibility === "sealed") {
    const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
    await handleSealedPull(io, ctx, note, pulledBy, inJarCount, deps, liveConfig, socket);
    return;
  }
  if (liveConfig?.pullVisibility === "private") {
    socket.emit("note:pulled", note, pulledBy);
    const inJarCount = await noteQueries.countNotesByState(pool, ctx.jarId, "in_jar");
    // Count-only update to peers — pulledNotes omitted so clients preserve their own state.
    socket.to(ctx.roomId).emit("note:state", { inJarCount });
    return;
  }
  io.to(ctx.roomId).emit("note:pulled", note, pulledBy);
}

async function handleSealedPull(
  io: TypedServer,
  ctx: SocketContext,
  note: Note,
  pulledBy: string,
  inJarCount: number,
  deps: SocketDeps,
  liveConfig: { sealedRevealCount?: number; pullVisibility?: "shared" | "private" } | null,
  socket: TypedSocket,
): Promise<void> {
  if (!ctx.roomId) return;
  const revealAt = liveConfig?.sealedRevealCount ?? 1;
  const len = await deps.sealedNotesStore.push(ctx.roomId, note);
  if (liveConfig?.pullVisibility === "private") {
    // Don't leak the puller's display name to peers in private mode. Give
    // the puller their own name (for any local UX that cares) and blank it
    // out for everyone else.
    socket.emit("note:sealed", pulledBy, len, revealAt, inJarCount);
    socket.to(ctx.roomId).emit("note:sealed", "", len, revealAt, inJarCount);
  } else {
    io.to(ctx.roomId).emit("note:sealed", pulledBy, len, revealAt, inJarCount);
  }
  if (len < revealAt) return;

  // Atomic in Redis — only one pod wins the drain + emit.
  const revealed = await deps.sealedNotesStore.revealIfReady(ctx.roomId, revealAt);
  if (revealed.length === 0) return;

  if (liveConfig?.pullVisibility === "private") {
    // Each puller owns their own revealed note — broadcasting the whole batch
    // to the room would leak other members' notes. Fan out per-socket, and
    // skip sockets whose pulls aren't in the batch so they don't get an empty
    // note:reveal (which would clear their sealed count to 0 early).
    await fanOutPrivateReveal(io, deps, ctx.roomId, revealed);
    return;
  }
  io.to(ctx.roomId).emit("note:reveal", revealed);
}

async function fanOutPrivateReveal(
  io: TypedServer,
  deps: SocketDeps,
  roomId: string,
  revealed: Note[],
): Promise<void> {
  const [members, roomSockets] = await Promise.all([
    deps.presenceStore.getMembers(roomId),
    io.in(roomId).fetchSockets(),
  ]);
  const memberBySocketId = new Map(members.map((m) => [m.id, m]));
  // Every socket needs *some* note:reveal so their sealedCount resets to 0,
  // but only the puller receives the actual note payload. Sending an empty
  // array to non-pullers is how they clear their "3/3 sealed" counter
  // without seeing someone else's pull.
  for (const s of roomSockets) {
    const member = memberBySocketId.get(s.id);
    const mine = member ? revealed.filter((n) => isPullMine(n, member)) : [];
    s.emit("note:reveal", mine);
  }
}
