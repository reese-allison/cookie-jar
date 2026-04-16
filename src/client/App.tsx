import { useCallback, useState } from "react";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { RoomCodeEntry } from "./components/RoomCodeEntry";
import { RoomView } from "./components/RoomView";
import { useSocket } from "./hooks/useSocket";
import { useSession } from "./lib/auth-client";
import { useNoteStore } from "./stores/noteStore";
import { useRoomStore } from "./stores/roomStore";

function App() {
  const { data: session } = useSession();
  const { room, isConnected, isJoining, error, cursors, myId } = useRoomStore();
  const { inJarCount, pulledNotes, isAdding, jarConfig, jarAppearance, history } = useNoteStore();
  const { setError } = useRoomStore();
  const [isCreating, setIsCreating] = useState(false);
  const {
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
  } = useSocket();

  const user = session?.user
    ? { displayName: session.user.name, image: session.user.image ?? undefined }
    : null;

  const createJarAndJoin = useCallback(
    async (name: string) => {
      setIsCreating(true);
      try {
        // Create the jar
        const jarRes = await fetch("/api/jars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
        });
        if (!jarRes.ok) {
          const data = await jarRes.json();
          setError(data.error ?? "Failed to create jar");
          setIsCreating(false);
          return;
        }
        const jar = await jarRes.json();

        // Create a room for the jar
        const roomRes = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ jarId: jar.id }),
        });
        if (!roomRes.ok) {
          const data = await roomRes.json();
          setError(data.error ?? "Failed to create room");
          setIsCreating(false);
          return;
        }
        const newRoom = await roomRes.json();

        setIsCreating(false);
        // Auto-join the room
        joinRoom(newRoom.code, user?.displayName ?? "Host");
      } catch {
        setError("Something went wrong");
        setIsCreating(false);
      }
    },
    [joinRoom, setError, user?.displayName],
  );

  const cloneTemplateAndJoin = useCallback(
    async (jarId: string) => {
      setIsCreating(true);
      try {
        const cloneRes = await fetch(`/api/jars/${jarId}/clone`, {
          method: "POST",
          credentials: "include",
        });
        if (!cloneRes.ok) {
          const data = await cloneRes.json();
          setError(data.error ?? "Failed to clone template");
          setIsCreating(false);
          return;
        }
        const cloned = await cloneRes.json();

        const roomRes = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ jarId: cloned.id }),
        });
        if (!roomRes.ok) {
          const data = await roomRes.json();
          setError(data.error ?? "Failed to create room");
          setIsCreating(false);
          return;
        }
        const newRoom = await roomRes.json();

        setIsCreating(false);
        joinRoom(newRoom.code, user?.displayName ?? "Host");
      } catch {
        setError("Something went wrong");
        setIsCreating(false);
      }
    },
    [joinRoom, setError, user?.displayName],
  );

  // Match by socket id (unique per tab) — display name can collide between users
  const myMember = myId ? room?.members.find((m) => m.id === myId) : undefined;
  const isViewer = myMember?.role === "viewer" || !session?.user;
  const isOwner = myMember?.role === "owner";

  if (!room) {
    return (
      <RoomCodeEntry
        onJoin={joinRoom}
        onCreateJar={user ? createJarAndJoin : undefined}
        onCloneTemplate={user ? cloneTemplateAndJoin : undefined}
        isJoining={isJoining}
        isCreating={isCreating}
        error={error}
        user={user}
      />
    );
  }

  return (
    <>
      <ConnectionStatus isConnected={isConnected} hasRoom={!!room} />
      <RoomView
        room={room}
        cursors={cursors}
        inJarCount={inJarCount}
        pulledNotes={pulledNotes}
        isAdding={isAdding}
        isViewer={isViewer}
        isOwner={isOwner ?? false}
        showPulledBy={jarConfig?.showPulledBy ?? false}
        jarAppearance={jarAppearance ?? undefined}
        onMouseMove={moveCursor}
        onLock={lockRoom}
        onUnlock={unlockRoom}
        onLeave={leaveRoom}
        onAddNote={addNote}
        onPull={pullNote}
        onDiscard={discardNote}
        onReturn={returnNote}
        history={history}
        onGetHistory={getHistory}
        onClearHistory={!isViewer ? clearHistory : undefined}
      />
    </>
  );
}

export default App;
