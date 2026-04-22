import { CURSOR_BROADCAST_INTERVAL_MS } from "@shared/constants";
import { createThrottle } from "@shared/throttle";
import type { ClientToServerEvents, NoteStyle, ServerToClientEvents } from "@shared/types";
import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { soundManager } from "../lib/sounds";
import { useNoteStore } from "../stores/noteStore";
import { useRoomStore } from "../stores/roomStore";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseSocketOptions {
  /**
   * Called when the server emits `auth:expired` (session invalidated
   * mid-session). The caller is expected to open whatever sign-in UI
   * they have — the toast alone auto-dismisses in 6 s and a busy user
   * will miss it. Optional so the hook remains usable without UI hooks
   * (e.g. in tests).
   */
  onAuthExpired?: () => void;
}

export function useSocket({ onAuthExpired }: UseSocketOptions = {}) {
  const socketRef = useRef<TypedSocket | null>(null);
  // Stash in a ref so the `useEffect` below doesn't resubscribe every render —
  // parents typically pass an inline arrow, which would otherwise churn the
  // socket listeners and leak state.
  const onAuthExpiredRef = useRef(onAuthExpired);
  onAuthExpiredRef.current = onAuthExpired;
  // Shared throttle helper — tested in tests/shared/throttle.test.ts.
  const cursorThrottleRef = useRef(createThrottle(CURSOR_BROADCAST_INTERVAL_MS));
  const dragThrottleRef = useRef(createThrottle(CURSOR_BROADCAST_INTERVAL_MS));
  // Remembers the last successful join args so we can auto-rejoin after a
  // transparent reconnect — the server assigns a fresh socket id on reconnect
  // and has no memory of our presence, so the client has to re-emit room:join.
  const lastJoinRef = useRef<{ code: string; displayName: string } | null>(null);
  // True after the first successful connect. Gates the auto-rejoin emit so
  // the INITIAL connect doesn't race with joinRoom()'s own explicit emit —
  // they'd both land at the server and peers would see the new member added
  // twice in their room list.
  const hasConnectedRef = useRef(false);

  // Narrow selectors throughout — Zustand setters have stable identity, so
  // pulling each one individually avoids the re-render storm that a
  // whole-store destructure would cause on every `cursor:moved` packet
  // (15 Hz × peers). Verified by tests/client/stores/narrowSelectors.test.tsx.
  const setRoom = useRoomStore((s) => s.setRoom);
  const setConnected = useRoomStore((s) => s.setConnected);
  const setJoining = useRoomStore((s) => s.setJoining);
  const setError = useRoomStore((s) => s.setError);
  const setMyId = useRoomStore((s) => s.setMyId);
  const addMember = useRoomStore((s) => s.addMember);
  const removeMember = useRoomStore((s) => s.removeMember);
  const setCursor = useRoomStore((s) => s.setCursor);
  const roomReset = useRoomStore((s) => s.reset);

  const setNoteState = useNoteStore((s) => s.setNoteState);
  const noteAdded = useNoteStore((s) => s.noteAdded);
  const notePulled = useNoteStore((s) => s.notePulled);
  const noteDiscarded = useNoteStore((s) => s.noteDiscarded);
  const noteReturned = useNoteStore((s) => s.noteReturned);
  const noteUpdated = useNoteStore((s) => s.noteUpdated);
  const markHistoryDirty = useNoteStore((s) => s.markHistoryDirty);
  const noteSealed = useNoteStore((s) => s.noteSealed);
  const notesRevealed = useNoteStore((s) => s.notesRevealed);
  const setHistory = useNoteStore((s) => s.setHistory);
  const setAdding = useNoteStore((s) => s.setAdding);
  const setPulling = useNoteStore((s) => s.setPulling);
  const setPeerDrag = useNoteStore((s) => s.setPeerDrag);
  const clearPeerDrag = useNoteStore((s) => s.clearPeerDrag);
  const clearPeerDragsByUser = useNoteStore((s) => s.clearPeerDragsByUser);
  const noteReset = useNoteStore((s) => s.reset);

  useEffect(() => {
    const socket: TypedSocket = io({
      autoConnect: false,
      transports: ["websocket"],
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setMyId(socket.id ?? null);
      setError(null);
      // Only auto-rejoin on ACTUAL reconnects. The initial connect already
      // has a room:join queued by joinRoom() (socket.io buffers emits before
      // connection); firing a second one here would land twice at the server
      // and peers would see the member added twice.
      const last = lastJoinRef.current;
      if (hasConnectedRef.current && last) {
        socket.emit("room:join", last.code, last.displayName);
      }
      hasConnectedRef.current = true;
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setMyId(null);
      // Any action the user fired right before the blip is now inflight-lost —
      // without this, the spinner stays stuck until some later event (rate_limited,
      // room:error) resets it. Cheaper and more honest to reset here.
      setAdding(false);
      setPulling(false);
      // Pulls may have happened while we were offline. The next open of the
      // history panel must refetch rather than render stale entries — the
      // note:state we get on auto-rejoin doesn't include history.
      markHistoryDirty();
    });

    // Room events
    socket.on("room:state", (room) => setRoom(room));
    socket.on("room:error", (error) => {
      setError(error);
      setAdding(false);
      setPulling(false);
      // A room:error after reconnect means the room is gone (closed, full,
      // etc.). Clear the auto-rejoin memo so we don't spin on the next
      // reconnect. The normal join flow will repopulate lastJoinRef if the
      // user tries again.
      lastJoinRef.current = null;
    });
    socket.on("auth:expired", () => {
      // Server is about to disconnect us. The toast auto-dismisses in 6 s,
      // so also call the caller's sign-in opener — a user mid-activity
      // will miss a silent toast but can't miss a modal. Clearing
      // lastJoinRef prevents the reconnect handler from spinning on a
      // room the expired session can't rejoin.
      setError("Your session expired. Please sign in again.");
      lastJoinRef.current = null;
      onAuthExpiredRef.current?.();
    });
    socket.on("rate_limited", (event, retryInMs) => {
      // Event name (e.g. "note:pull") is an internal detail; the user only
      // needs the cooldown in human-readable seconds. Round up so a 500 ms
      // budget doesn't show as "0 seconds".
      const seconds = Math.max(1, Math.ceil(retryInMs / 1000));
      setError(
        `You're doing that too fast. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
      );
      // Clear the pending-flag for whichever action got throttled so the
      // button doesn't stay stuck in a loading state forever.
      if (event === "note:add") setAdding(false);
      else if (event === "note:pull") setPulling(false);
    });
    socket.on("room:member_joined", (member) => {
      addMember(member);
      soundManager.play("userJoin");
    });
    socket.on("room:member_left", (memberId) => {
      removeMember(memberId);
      clearPeerDragsByUser(memberId);
      soundManager.play("userLeave");
    });
    socket.on("cursor:moved", (cursor) => setCursor(cursor));

    // Note events
    socket.on("note:state", (state) => {
      setNoteState(state);
      // Apply jar's custom sound pack if present
      if (state.jarAppearance?.soundPack) {
        soundManager.setCustomPack(state.jarAppearance.soundPack);
      } else {
        soundManager.clearCustomPack();
      }
    });
    socket.on("note:added", (note, inJarCount) => {
      noteAdded(note, inJarCount);
      soundManager.play("noteAdd");
    });
    socket.on("note:pulled", (note) => {
      notePulled(note);
      soundManager.play("notePull");
    });
    socket.on("note:discarded", (noteId) => {
      noteDiscarded(noteId);
      soundManager.play("noteDiscard");
    });
    socket.on("note:returned", (noteId, inJarCount) => {
      noteReturned(noteId, inJarCount);
      soundManager.play("noteReturn");
    });
    socket.on("note:updated", (note) => {
      noteUpdated(note);
    });
    socket.on("pull:rejected", () => setPulling(false));
    socket.on("note:sealed", (_pulledBy, sealedCount, revealAt, inJarCount) =>
      noteSealed(sealedCount, revealAt, inJarCount),
    );
    socket.on("note:reveal", (notes) => {
      notesRevealed(notes);
      // Empty payload is the "your sealed counter should reset" signal for
      // private-mode peers who weren't the puller — no pull sound for them.
      if (notes.length > 0) soundManager.play("notePull");
    });
    socket.on("note:drag", (noteId, draggerId, mx, my) => {
      setPeerDrag(noteId, { draggerId, mx, my });
    });
    socket.on("note:drag_end", (noteId) => {
      clearPeerDrag(noteId);
    });
    socket.on("history:list", (entries) => setHistory(entries));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [
    setRoom,
    setConnected,
    setError,
    setMyId,
    addMember,
    removeMember,
    setCursor,
    setNoteState,
    noteAdded,
    notePulled,
    noteDiscarded,
    noteReturned,
    noteUpdated,
    markHistoryDirty,
    noteSealed,
    notesRevealed,
    setAdding,
    setPulling,
    setHistory,
    setPeerDrag,
    clearPeerDrag,
    clearPeerDragsByUser,
  ]);

  const joinRoom = useCallback(
    (code: string, displayName: string) => {
      const socket = socketRef.current;
      if (!socket) return;

      setJoining(true);
      // Stash for the reconnect handler. If the server rejects this join
      // (room not found, full, closed), the matching room:error handler
      // clears lastJoinRef so we don't spin re-joining a dead room.
      lastJoinRef.current = { code, displayName };
      if (!socket.connected) {
        socket.connect();
      }
      socket.emit("room:join", code, displayName);
    },
    [setJoining],
  );

  const leaveRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("room:leave");
    socket.disconnect();
    lastJoinRef.current = null;
    // Voluntary disconnect — treat the next connect as a fresh initial connect
    // so joinRoom's explicit emit isn't doubled by the auto-rejoin path.
    hasConnectedRef.current = false;
    roomReset();
    noteReset();
  }, [roomReset, noteReset]);

  const moveCursor = useCallback((x: number, y: number) => {
    if (!cursorThrottleRef.current()) return;
    socketRef.current?.emit("cursor:move", { x, y });
  }, []);

  const addNote = useCallback(
    (note: { text: string; url?: string; style: NoteStyle }) => {
      setAdding(true);
      socketRef.current?.emit("note:add", note);
    },
    [setAdding],
  );

  const pullNote = useCallback(() => {
    setPulling(true);
    socketRef.current?.emit("note:pull");
  }, [setPulling]);

  const discardNote = useCallback((noteId: string) => {
    socketRef.current?.emit("note:discard", noteId);
  }, []);

  const returnNote = useCallback((noteId: string) => {
    socketRef.current?.emit("note:return", noteId);
  }, []);

  const returnAllNotes = useCallback(() => {
    socketRef.current?.emit("note:returnAll");
  }, []);

  const discardAllNotes = useCallback(() => {
    socketRef.current?.emit("note:discardAll");
  }, []);

  const getHistory = useCallback(() => {
    socketRef.current?.emit("history:get");
  }, []);

  const clearHistory = useCallback(() => {
    socketRef.current?.emit("history:clear");
  }, []);

  const dragNote = useCallback((noteId: string, mx: number, my: number) => {
    if (!dragThrottleRef.current()) return;
    socketRef.current?.emit("note:drag", noteId, mx, my);
  }, []);

  const dragNoteEnd = useCallback((noteId: string) => {
    socketRef.current?.emit("note:drag_end", noteId);
  }, []);

  const refreshJar = useCallback(() => {
    socketRef.current?.emit("jar:refresh");
  }, []);

  return {
    joinRoom,
    leaveRoom,
    moveCursor,
    addNote,
    pullNote,
    discardNote,
    returnNote,
    returnAllNotes,
    discardAllNotes,
    getHistory,
    clearHistory,
    dragNote,
    dragNoteEnd,
    refreshJar,
  };
}
