import { CURSOR_BROADCAST_INTERVAL_MS } from "@shared/constants";
import type { ClientToServerEvents, ServerToClientEvents } from "@shared/types";
import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useRoomStore } from "../stores/roomStore";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSocket() {
  const socketRef = useRef<TypedSocket | null>(null);
  const throttleRef = useRef<number>(0);

  const {
    setRoom,
    setConnected,
    setJoining,
    addMember,
    removeMember,
    setCursor,
    setLocked,
    reset,
  } = useRoomStore();

  useEffect(() => {
    const socket: TypedSocket = io({
      autoConnect: false,
      transports: ["websocket"],
    });

    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => {
      setConnected(false);
      reset();
    });

    socket.on("room:state", (room) => setRoom(room));
    socket.on("room:member_joined", (member) => addMember(member));
    socket.on("room:member_left", (memberId) => removeMember(memberId));
    socket.on("room:locked", () => setLocked(true));
    socket.on("room:unlocked", () => setLocked(false));
    socket.on("cursor:moved", (cursor) => setCursor(cursor));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [setRoom, setConnected, addMember, removeMember, setCursor, setLocked, reset]);

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
    reset();
  }, [reset]);

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

  return { joinRoom, leaveRoom, moveCursor, lockRoom, unlockRoom };
}
