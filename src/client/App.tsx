import { RoomCodeEntry } from "./components/RoomCodeEntry";
import { RoomView } from "./components/RoomView";
import { useSocket } from "./hooks/useSocket";
import { useRoomStore } from "./stores/roomStore";

function App() {
  const { room, isJoining, error, cursors } = useRoomStore();
  const { joinRoom, leaveRoom, moveCursor, lockRoom, unlockRoom } = useSocket();

  if (!room) {
    return <RoomCodeEntry onJoin={joinRoom} isJoining={isJoining} error={error} />;
  }

  return (
    <RoomView
      room={room}
      cursors={cursors}
      onMouseMove={moveCursor}
      onLock={lockRoom}
      onUnlock={unlockRoom}
      onLeave={leaveRoom}
    />
  );
}

export default App;
