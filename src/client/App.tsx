import { ConnectionStatus } from "./components/ConnectionStatus";
import { RoomCodeEntry } from "./components/RoomCodeEntry";
import { RoomView } from "./components/RoomView";
import { useSocket } from "./hooks/useSocket";
import { useSession } from "./lib/auth-client";
import { useNoteStore } from "./stores/noteStore";
import { useRoomStore } from "./stores/roomStore";

function App() {
  const { data: session } = useSession();
  const { room, isConnected, isJoining, error, cursors } = useRoomStore();
  const { inJarCount, pulledNotes, isAdding, jarConfig, history } = useNoteStore();
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

  // Determine if current user is a viewer (find our member in the room)
  const myMember = room?.members.find((m) =>
    user ? m.displayName === user.displayName : m.role === "viewer",
  );
  const isViewer = myMember?.role === "viewer" || !session?.user;

  if (!room) {
    return <RoomCodeEntry onJoin={joinRoom} isJoining={isJoining} error={error} user={user} />;
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
        showPulledBy={jarConfig?.showPulledBy ?? false}
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
