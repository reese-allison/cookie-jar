import { CURSOR_BROADCAST_INTERVAL_MS } from "@shared/constants";
import { createThrottle } from "@shared/throttle";
import type { ClientToServerEvents, NoteStyle, ServerToClientEvents } from "@shared/types";
import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { soundManager } from "../lib/sounds";
import { useNoteStore } from "../stores/noteStore";
import { useRoomStore } from "../stores/roomStore";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSocket() {
  const socketRef = useRef<TypedSocket | null>(null);
  // Shared throttle helper — tested in tests/shared/throttle.test.ts.
  const cursorThrottleRef = useRef(createThrottle(CURSOR_BROADCAST_INTERVAL_MS));
  const dragThrottleRef = useRef(createThrottle(CURSOR_BROADCAST_INTERVAL_MS));

  const {
    setRoom,
    setConnected,
    setJoining,
    setError,
    setMyId,
    addMember,
    removeMember,
    setCursor,
    setLocked,
  } = useRoomStore();
  const roomReset = useRoomStore((s) => s.reset);

  const {
    setNoteState,
    noteAdded,
    notePulled,
    noteDiscarded,
    noteReturned,
    noteSealed,
    notesRevealed,
    setHistory,
    setAdding,
    setPulling,
    setPeerDrag,
    clearPeerDrag,
    clearPeerDragsByUser,
  } = useNoteStore();
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
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setMyId(null);
    });

    // Room events
    socket.on("room:state", (room) => setRoom(room));
    socket.on("room:error", (error) => {
      setError(error);
      setAdding(false);
      setPulling(false);
    });
    socket.on("auth:expired", () => {
      // Server is about to disconnect us — surface a specific message so the
      // UI can point the user at sign-in rather than showing a generic
      // "disconnected" banner.
      setError("Your session expired. Please sign in again.");
    });
    socket.on("rate_limited", (event, retryInMs) => {
      setError(`You're doing that too fast (${event}). Try again in ${retryInMs}ms.`);
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
    socket.on("room:locked", () => setLocked(true));
    socket.on("room:unlocked", () => setLocked(false));
    socket.on("cursor:moved", (cursor) => setCursor(cursor));

    // Note events
    socket.on("note:state", (state) => {
      setNoteState(
        state.inJarCount,
        state.pulledNotes,
        state.pullCounts,
        state.jarConfig,
        state.jarAppearance,
      );
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
    socket.on("pull:rejected", () => setPulling(false));
    socket.on("note:sealed", (_pulledBy, sealedCount, revealAt, inJarCount) =>
      noteSealed(sealedCount, revealAt, inJarCount),
    );
    socket.on("note:reveal", (notes) => {
      notesRevealed(notes);
      soundManager.play("notePull");
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
    setLocked,
    setNoteState,
    noteAdded,
    notePulled,
    noteDiscarded,
    noteReturned,
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
    roomReset();
    noteReset();
  }, [roomReset, noteReset]);

  const moveCursor = useCallback((x: number, y: number) => {
    if (!cursorThrottleRef.current()) return;
    socketRef.current?.emit("cursor:move", { x, y });
  }, []);

  const lockRoom = useCallback(() => {
    socketRef.current?.emit("room:lock");
  }, []);

  const unlockRoom = useCallback(() => {
    socketRef.current?.emit("room:unlock");
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
    lockRoom,
    unlockRoom,
    addNote,
    pullNote,
    discardNote,
    returnNote,
    getHistory,
    clearHistory,
    dragNote,
    dragNoteEnd,
    refreshJar,
  };
}
