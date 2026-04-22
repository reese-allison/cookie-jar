import type { JarAppearance, JarConfig, RoomMember } from "@shared/types";
import { isValidDisplayName } from "@shared/validation";
import { canJoinJar } from "../access";
import pool from "../db/pool";
import * as jarQueries from "../db/queries/jars";
import * as noteQueries from "../db/queries/notes";
import * as roomQueries from "../db/queries/rooms";
import type { SocketContext } from "./context";
import type { SocketDeps } from "./deps";
import { withErrorHandler } from "./errorHandler";
import { fireAndForget } from "./fireAndForget";
import type { IdleTimeoutManager } from "./idleTimeout";
import { socketRateLimiter } from "./rateLimit";
import {
  attachMember,
  buildJarRefreshPayload,
  buildNoteStateShared,
  buildRoomState,
  determineRole,
  isPullMine,
  kickPriorSession,
  pickColor,
  sendNoteState,
  startIdleTimeout,
  type TypedSocket,
  validateRoomJoin,
} from "./roomHelpers";
import type { TypedServer } from "./server";

// Re-exported for tests that still import from here.
export { buildJarRefreshPayload };

/**
 * Run the per-join sequence (kick prior session, atomic presence insert with
 * stale-entry sweep, ctx attach, socket.join). Extracted from the room:join
 * handler so the event handler fits under the cognitive-complexity limit.
 * Returns the data the handler needs to finish emitting or null if the join
 * was rejected (cap hit — error already emitted).
 */
/**
 * Emit room:member_left + apply on-leave behavior for presence rows that
 * got purged without a clean disconnect (Lua sweep, reconcile). Both paths
 * share this so "user leaves" semantics (discarding / returning their notes)
 * are identical whether they closed cleanly, crashed, or timed out.
 */
function cleanupGhosts(
  io: TypedServer,
  deps: SocketDeps,
  roomId: string,
  jarId: string,
  memberLookup: Map<string, RoomMember>,
  staleIds: string[],
  source: string,
): void {
  for (const staleId of staleIds) {
    io.to(roomId).emit("room:member_left", staleId);
    const stale = io.sockets.sockets.get(staleId);
    if (stale) stale.disconnect();
    const ghost = memberLookup.get(staleId);
    if (!ghost) continue;
    fireAndForget(
      applyOnLeaveBehavior(io, deps, roomId, jarId, ghost.userId ?? null, ghost.displayName),
      `applyOnLeaveBehavior(${source})`,
    );
  }
}

/**
 * When the initial addMember fails with "full", reconcile presence against
 * the actual live socket set (ghost rows from pod crashes or pre-userId
 * migration rows can't be swept by userId match) and retry.
 */
async function reconcileAndRetryAdd(
  io: TypedServer,
  deps: SocketDeps,
  roomId: string,
  jarId: string,
  member: RoomMember,
  preSweepMembers: Map<string, RoomMember>,
  dbRoom: NonNullable<Awaited<ReturnType<typeof roomQueries.getRoomByCode>>>,
): Promise<Awaited<ReturnType<typeof deps.presenceStore.addMemberIfUnderCap>>> {
  const live = await io.in(roomId).fetchSockets();
  const liveIds = new Set(live.map((s) => s.id));
  const reaped = await deps.presenceStore.reconcile(roomId, liveIds);
  if (reaped.length === 0) return { ok: false, reason: "full" };
  cleanupGhosts(io, deps, roomId, jarId, preSweepMembers, reaped, "reconcile");
  return deps.presenceStore.addMemberIfUnderCap(
    roomId,
    member,
    dbRoom.maxParticipants,
    dbRoom.maxViewers,
  );
}

async function commitJoin(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
  deps: SocketDeps,
  dbRoom: Awaited<ReturnType<typeof roomQueries.getRoomByCode>>,
  displayName: string,
): Promise<{
  member: RoomMember;
  jar: Awaited<ReturnType<typeof jarQueries.getJarById>>;
  pulledMembers: RoomMember[];
  roomState: { effectiveName: string };
} | null> {
  if (!dbRoom) return null;
  const roomId = dbRoom.id;
  const members = await deps.presenceStore.getMembers(roomId);
  const jar = await jarQueries.getJarById(pool, dbRoom.jarId);
  // Enforce the jar's access rules before we touch presence or disclose room
  // state. An allowlisted jar can still be joined by its allowlist; an
  // unlisted jar falls back to public/template/owner rules via canAccessJar.
  if (
    jar &&
    !canJoinJar(jar, {
      userId: ctx.userId,
      email: ctx.email,
      emailVerified: ctx.emailVerified,
    })
  ) {
    socket.emit("room:error", "Not authorized to join this jar");
    return null;
  }
  const role = determineRole(ctx, jar?.ownerId);
  const effectiveName = ctx.displayName ?? displayName;
  if (ctx.userId) await kickPriorSession(io, deps, roomId, ctx.userId, socket.id);

  const member: RoomMember = {
    id: socket.id,
    displayName: effectiveName,
    userId: ctx.userId ?? undefined,
    role,
    color: pickColor(members),
    connectedAt: new Date().toISOString(),
  };
  const memberById = new Map(members.map((m) => [m.id, m]));

  let result = await deps.presenceStore.addMemberIfUnderCap(
    roomId,
    member,
    dbRoom.maxParticipants,
    dbRoom.maxViewers,
  );
  if (!result.ok) {
    result = await reconcileAndRetryAdd(io, deps, roomId, dbRoom.jarId, member, memberById, dbRoom);
  }
  if (!result.ok) {
    socket.emit("room:error", "Room is full");
    return null;
  }
  cleanupGhosts(io, deps, roomId, dbRoom.jarId, memberById, result.removed, "sweep");
  attachMember(ctx, member, roomId, dbRoom.jarId, jar?.config ?? null);
  await socket.join(roomId);
  return { member, jar, pulledMembers: result.members, roomState: { effectiveName } };
}

/**
 * Drain or auto-reveal the sealed buffer when the owner flips sealed → open
 * or lowers the threshold under the current buffer length.
 */
async function applySealedBufferEffects(
  io: TypedServer,
  deps: SocketDeps,
  roomId: string,
  prev: JarConfig | null,
  next: JarConfig | null,
): Promise<void> {
  const wasSealed = prev?.noteVisibility === "sealed";
  const isSealed = next?.noteVisibility === "sealed";
  if (wasSealed && !isSealed) {
    const drained = await deps.sealedNotesStore.drain(roomId);
    if (drained.length > 0) io.to(roomId).emit("note:reveal", drained);
    return;
  }
  if (isSealed) {
    const newThreshold = next?.sealedRevealCount ?? 1;
    const currentLen = await deps.sealedNotesStore.length(roomId);
    if (currentLen >= newThreshold) {
      const revealed = await deps.sealedNotesStore.revealIfReady(roomId, newThreshold);
      if (revealed.length > 0) io.to(roomId).emit("note:reveal", revealed);
    }
  }
}

/**
 * Send every socket in the room a filtered `note:state` so their `pulledNotes`
 * matches the new visibility mode. In private mode each socket sees only the
 * pulls that carry their own displayName; in shared mode everyone sees the
 * full list. Without this, flipping the toggle mid-session leaves clients
 * stuck with whatever state they had before the flip.
 *
 * Shared mode takes the cheap path — one `io.to(roomId).emit` so the socket
 * adapter fans out once. Private mode needs per-socket filtering and emits
 * individually. For a 50-member room this avoids 50× serialization work on
 * every jar:refresh under the shared default.
 */
async function rebroadcastPulledNotes(
  io: TypedServer,
  deps: SocketDeps,
  roomId: string,
  jarId: string,
  jar: { name?: string | null; config: JarConfig | null; appearance: JarAppearance | null },
  isPrivate: boolean,
): Promise<void> {
  const [allPulled, shared] = await Promise.all([
    noteQueries.listNotesByJar(pool, jarId, "pulled"),
    buildNoteStateShared(jar, jarId, roomId, deps),
  ]);
  if (!isPrivate) {
    io.to(roomId).emit("note:state", { ...shared, pulledNotes: allPulled });
    return;
  }
  // Private: each socket sees only pulls attributed to them. Presence is the
  // source of truth for display names — SocketContext lives in a handler
  // closure, not on socket.data, so we can't read it from RemoteSocket.
  const [members, roomSockets] = await Promise.all([
    deps.presenceStore.getMembers(roomId),
    io.in(roomId).fetchSockets(),
  ]);
  const memberBySocketId = new Map(members.map((m) => [m.id, m]));
  for (const s of roomSockets) {
    const member = memberBySocketId.get(s.id);
    const pulledNotes = member ? allPulled.filter((n) => isPullMine(n, member)) : [];
    s.emit("note:state", { ...shared, pulledNotes });
  }
}

export function registerRoomHandlers(
  io: TypedServer,
  socket: TypedSocket,
  ctx: SocketContext,
  deps: SocketDeps,
  idleTimeouts?: IdleTimeoutManager,
): void {
  // biome-ignore lint/suspicious/noExplicitAny: socket handlers have varied signatures
  const safe = (handler: (...args: any[]) => unknown) => withErrorHandler(socket, handler);

  socket.on(
    "room:join",
    safe(async (code: string, displayName: string) => {
      if (!isValidDisplayName(displayName)) {
        socket.emit("room:error", "Display name must be 1-30 characters");
        return;
      }
      // Room codes are stored uppercase. Normalize here too so the socket
      // path matches the REST path — clients typing lowercase should still
      // find the room.
      const dbRoom = await roomQueries.getRoomByCode(pool, code.toUpperCase());
      const joinError = validateRoomJoin(dbRoom);
      if (joinError || !dbRoom) {
        socket.emit("room:error", joinError ?? "Room not found");
        return;
      }

      const committed = await commitJoin(io, socket, ctx, deps, dbRoom, displayName);
      if (!committed) return;
      const { member, jar, roomState, pulledMembers } = committed;
      socket.emit("room:state", buildRoomState(dbRoom, pulledMembers));
      const jarConfig = jar?.config ?? null;
      const jarAppearance = jar?.appearance ?? null;
      await sendNoteState(
        socket,
        {
          name: jar?.name ?? null,
          ownerId: jar?.ownerId ?? null,
          config: jarConfig,
          appearance: jarAppearance,
        },
        dbRoom.jarId,
        dbRoom.id,
        deps,
        jarConfig?.pullVisibility === "private",
        roomState.effectiveName,
        ctx.userId,
      );
      socket.to(dbRoom.id).emit("room:member_joined", member);

      startIdleTimeout(io, idleTimeouts, dbRoom.id, dbRoom.jarId, dbRoom.idleTimeoutMinutes, deps);
    }),
  );

  socket.on("room:leave", () => {
    fireAndForget(handleLeave(), "handleLeave(room:leave)");
  });
  socket.on("disconnect", () => {
    fireAndForget(handleLeave(), "handleLeave(disconnect)");
    socketRateLimiter.dispose(socket.id);
  });

  socket.on("cursor:move", (position) => {
    if (!ctx.roomId) return;
    // Silent drop — cursor packets are volatile, and cursoring through the
    // "rate_limited" UX for a best-effort stream would be noisy. The budget
    // is set so a human client never hits it.
    if (!socketRateLimiter.allow(socket.id, "cursor:move")) return;
    // Validate: socket.io types don't run at runtime, so a crafted client
    // can send {x: "💩", y: {}}. We'd broadcast junk that breaks peers'
    // cursor rendering. Silently drop malformed packets.
    if (
      !position ||
      typeof position.x !== "number" ||
      typeof position.y !== "number" ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }
    idleTimeouts?.resetActivity(ctx.roomId);
    socket.volatile.to(ctx.roomId).emit("cursor:moved", {
      x: position.x,
      y: position.y,
      userId: socket.id,
    });
  });

  // Lock is a jar-config field (jarConfig.locked) — the owner toggles it
  // from JarSettingsDrawer, which PATCHes the jar and fires jar:refresh. The
  // dedicated `room:lock`/`room:unlock` events have been retired.

  // Owner requests a re-broadcast of jar state after a REST PATCH (name,
  // appearance, config). Most of the work is compact-delta fanout, but a
  // config change can invalidate in-flight state:
  //
  //   - sealed → open: drain the sealed buffer and reveal whatever's in it,
  //     otherwise those notes leak until the room closes.
  //   - sealedRevealCount lowered below current buffer length: auto-reveal
  //     instead of waiting for the next pull to trip the new threshold.
  //   - shared ↔ private flip: the pulledNotes each client is rendering
  //     needs to be refiltered per-socket (private shows only mine; shared
  //     shows everyone's), so we re-emit targeted note:state payloads.
  socket.on(
    "jar:refresh",
    safe(async () => {
      if (!socketRateLimiter.allow(socket.id, "jar:refresh")) {
        socket.emit("rate_limited", "jar:refresh", 3000);
        return;
      }
      if (!ctx.roomId || !ctx.jarId) return;
      if (ctx.role !== "owner") {
        socket.emit("room:error", "Only the jar owner can update the jar");
        return;
      }
      const jar = await jarQueries.getJarById(pool, ctx.jarId);
      if (!jar) return;
      const prevConfig = ctx.jarConfig;
      ctx.jarConfig = jar.config ?? null;
      // Invalidate the pod-wide config cache, then re-send a full note:state
      // (including pulledNotes, per-socket filtered when private). This is a
      // little heavier than the previous compact delta, but it's what makes
      // renderer-only config toggles (showAuthors, showPulledBy) take effect
      // without a page refresh — the pulled notes need to carry their fresh
      // authorDisplayName / pulledBy metadata all the way down.
      deps.roomStateCache.invalidateJar(ctx.jarId);
      fireAndForget(
        deps.cacheBus.publish({ scope: "jar", id: ctx.jarId }),
        "cacheBus.publish(jar:refresh)",
      );
      await rebroadcastPulledNotes(
        io,
        deps,
        ctx.roomId,
        ctx.jarId,
        jar,
        ctx.jarConfig?.pullVisibility === "private",
      );
      await applySealedBufferEffects(io, deps, ctx.roomId, prevConfig, ctx.jarConfig);
    }),
  );

  async function handleLeave(): Promise<void> {
    if (!ctx.roomId || !ctx.memberId) return;
    const { roomId, memberId, userId, jarId, displayName } = ctx;

    // Fire-and-forget: a failure here (DB hiccup, config read timeout) must
    // not swallow room:member_left below. Peers need the departure event
    // regardless; the note-transition broadcasts arrive later when the query
    // succeeds.
    if (jarId) {
      fireAndForget(
        applyOnLeaveBehavior(io, deps, roomId, jarId, userId, displayName),
        "applyOnLeaveBehavior",
      );
    }

    await deps.presenceStore.removeMember(roomId, memberId);
    const remaining = await deps.presenceStore.memberCount(roomId);
    if (remaining === 0) {
      await deps.presenceStore.clearRoom(roomId);
      idleTimeouts?.stop(roomId);
      // Close the room in the DB now that it's empty — the idle timer we just
      // stopped would never fire, so without this the row would sit in state
      // 'open' forever and pile up in the owner's "My Jars" list. Also reset
      // any still-pulled notes back to in_jar (matches idle-timeout semantics;
      // handles edge cases where applyOnLeaveBehavior didn't catch everything).
      if (jarId) {
        fireAndForget(
          noteQueries.resetPulledNotesForJar(pool, jarId),
          "resetPulledNotesForJar(lastLeave)",
        );
      }
      fireAndForget(
        roomQueries.updateRoomState(pool, roomId, "closed"),
        "updateRoomState(lastLeave)",
      );
      fireAndForget(deps.sealedNotesStore.clear(roomId), "sealedNotesStore.clear");
    }

    if (userId) {
      // Fire-and-forget — compare-and-delete, so a stale release can't clobber
      // a newer tab that already claimed the slot.
      fireAndForget(deps.dedupStore.release(roomId, userId, memberId), "dedupStore.release");
    }

    socket.to(roomId).emit("room:member_left", memberId);
    socket.leave(roomId);

    ctx.roomId = null;
    ctx.jarId = null;
    ctx.memberId = null;
  }
}

/**
 * When a member leaves, flip every note they had pulled back into the jar or
 * into the discard pile based on `jarConfig.onLeaveBehavior`. Emits per-note
 * broadcasts so peers' UIs update without a full re-sync.
 */
async function applyOnLeaveBehavior(
  io: TypedServer,
  deps: SocketDeps,
  roomId: string,
  jarId: string,
  userId: string | null,
  displayName: string | null,
): Promise<void> {
  const { config } = await deps.roomStateCache.getJar(jarId);
  const behavior = config?.onLeaveBehavior ?? "return";
  const nextState = behavior === "discard" ? "discarded" : "in_jar";
  const movedIds = await noteQueries.transitionPulledNotesFor(pool, jarId, nextState, {
    userId,
    displayName,
  });
  if (movedIds.length === 0) return;
  // Any of these ids could still be sitting in the sealed buffer (the leaver
  // had pulls queued against a sealed reveal). Strip them or they'll surface
  // as zombies on the next reveal — the note's DB state has already moved
  // back to in_jar/discarded, so materializing them on the table would show
  // notes that no one actually holds anymore.
  for (const id of movedIds) {
    fireAndForget(deps.sealedNotesStore.remove(roomId, id), "sealedNotesStore.remove(onLeave)");
  }
  if (nextState === "discarded") {
    for (const id of movedIds) io.to(roomId).emit("note:discarded", id);
    return;
  }
  // "return" path: each becomes in_jar. Clients track inJarCount from the
  // `note:returned` payload, so emit per-note with an updated count each.
  const finalCount = await noteQueries.countNotesByState(pool, jarId, "in_jar");
  for (const id of movedIds) io.to(roomId).emit("note:returned", id, finalCount);
}
