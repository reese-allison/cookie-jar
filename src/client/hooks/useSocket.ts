import { CURSOR_BROADCAST_INTERVAL_MS } from "@shared/constants";
import type { ClientToServerEvents, NoteStyle, ServerToClientEvents } from "@shared/types";
import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { soundManager } from "../lib/sounds";
import { useNoteStore } from "../stores/noteStore";
import { useRoomStore } from "../stores/roomStore";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSocket() {
  const socketRef = useRef<TypedSocket | null>(null);
  const throttleRef = useRef<number>(0);

  const {
    setRoom,
    setConnected,
    setJoining,
    setError,
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
    setHistory,
    setAdding,
    setPulling,
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
      setError(null);
    });
    socket.on("disconnect", () => {
      setConnected(false);
    });

    // Room events
    socket.on("room:state", (room) => setRoom(room));
    socket.on("room:error", (error) => setError(error));
    socket.on("room:member_joined", (member) => {
      addMember(member);
      soundManager.play("userJoin");
    });
    socket.on("room:member_left", (memberId) => {
      removeMember(memberId);
      soundManager.play("userLeave");
    });
    socket.on("room:locked", () => setLocked(true));
    socket.on("room:unlocked", () => setLocked(false));
    socket.on("cursor:moved", (cursor) => setCursor(cursor));

    // Note events
    socket.on("note:state", (state) =>
      setNoteState(state.inJarCount, state.pulledNotes, state.pullCounts, state.jarConfig),
    );
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
    socket.on("history:list", (entries) => setHistory(entries));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [
    setRoom,
    setConnected,
    setError,
    addMember,
    removeMember,
    setCursor,
    setLocked,
    setNoteState,
    noteAdded,
    notePulled,
    noteDiscarded,
    noteReturned,
    setPulling,
    setHistory,
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
    const now = Date.now();
    if (now - throttleRef.current < CURSOR_BROADCAST_INTERVAL_MS) return;
    throttleRef.current = now;
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
  };
}
