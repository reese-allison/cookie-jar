import { RoomCodeEntry } from "./components/RoomCodeEntry";
import { RoomView } from "./components/RoomView";
import { useSocket } from "./hooks/useSocket";
import { useNoteStore } from "./stores/noteStore";
import { useRoomStore } from "./stores/roomStore";

function App() {
  const { room, isJoining, error, cursors } = useRoomStore();
  const { inJarCount, pulledNotes, isAdding } = useNoteStore();
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
  } = useSocket();

  if (!room) {
    return <RoomCodeEntry onJoin={joinRoom} isJoining={isJoining} error={error} />;
  }

  return (
    <RoomView
      room={room}
      cursors={cursors}
      inJarCount={inJarCount}
      pulledNotes={pulledNotes}
      isAdding={isAdding}
      onMouseMove={moveCursor}
      onLock={lockRoom}
      onUnlock={unlockRoom}
      onLeave={leaveRoom}
      onAddNote={addNote}
      onPull={pullNote}
      onDiscard={discardNote}
      onReturn={returnNote}
    />
  );
}

export default App;
