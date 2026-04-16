import { CURSOR_BROADCAST_INTERVAL_MS } from "@shared/constants";
import type { ClientToServerEvents, NoteStyle, ServerToClientEvents } from "@shared/types";
import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useNoteStore } from "../stores/noteStore";
import { useRoomStore } from "../stores/roomStore";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSocket() {
  const socketRef = useRef<TypedSocket | null>(null);
  const throttleRef = useRef<number>(0);

  const { setRoom, setConnected, setJoining, addMember, removeMember, setCursor, setLocked } =
    useRoomStore();
  const roomReset = useRoomStore((s) => s.reset);

  const {
    setNoteState,
    noteAdded,
    notePulled,
    noteDiscarded,
    noteReturned,
    setAdding,
    setPulling,
  } = useNoteStore();
  const noteReset = useNoteStore((s) => s.reset);

  useEffect(() => {
    const socket: TypedSocket = io({
      autoConnect: false,
      transports: ["websocket"],
    });

    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => {
      setConnected(false);
      roomReset();
      noteReset();
    });

    // Room events
    socket.on("room:state", (room) => setRoom(room));
    socket.on("room:member_joined", (member) => addMember(member));
    socket.on("room:member_left", (memberId) => removeMember(memberId));
    socket.on("room:locked", () => setLocked(true));
    socket.on("room:unlocked", () => setLocked(false));
    socket.on("cursor:moved", (cursor) => setCursor(cursor));

    // Note events
    socket.on("note:state", (state) => setNoteState(state.inJarCount, state.pulledNotes));
    socket.on("note:added", (note, inJarCount) => noteAdded(note, inJarCount));
    socket.on("note:pulled", (note) => {
      notePulled(note);
    });
    socket.on("note:discarded", (noteId) => noteDiscarded(noteId));
    socket.on("note:returned", (noteId, inJarCount) => noteReturned(noteId, inJarCount));
    socket.on("pull:rejected", () => setPulling(false));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [
    setRoom,
    setConnected,
    addMember,
    removeMember,
    setCursor,
    setLocked,
    roomReset,
    setNoteState,
    noteAdded,
    notePulled,
    noteDiscarded,
    noteReturned,
    setPulling,
    noteReset,
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
  };
}
