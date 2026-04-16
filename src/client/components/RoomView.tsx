import type { CursorPosition, Room } from "@shared/types";

interface RoomViewProps {
  room: Room;
  cursors: Map<string, CursorPosition>;
  onMouseMove: (x: number, y: number) => void;
  onLock: () => void;
  onUnlock: () => void;
  onLeave: () => void;
}

export function RoomView({ room, cursors, onMouseMove, onLock, onUnlock, onLeave }: RoomViewProps) {
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onMouseMove(e.clientX - rect.left, e.clientY - rect.top);
  };

  return (
    <div className="room-view">
      <header className="room-header">
        <span className="room-code">{room.code}</span>
        <span className="room-state">{room.state}</span>
        <div className="room-actions">
          {room.state === "open" ? (
            <button type="button" onClick={onLock}>
              Lock
            </button>
          ) : room.state === "locked" ? (
            <button type="button" onClick={onUnlock}>
              Unlock
            </button>
          ) : null}
          <button type="button" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      <div className="room-members">
        <h3>Members ({room.members.length})</h3>
        <ul>
          {room.members.map((member) => (
            <li key={member.id} style={{ color: member.color }}>
              {member.displayName}
            </li>
          ))}
        </ul>
      </div>

      <div className="room-scene" role="application" onMouseMove={handleMouseMove}>
        {/* Jar and notes will go here in Phase 3 */}
        <div className="jar-placeholder">
          <p>Jar goes here</p>
        </div>

        {/* Remote cursors */}
        {[...cursors.entries()].map(([userId, cursor]) => (
          <div
            key={userId}
            className="cursor"
            style={{
              position: "absolute",
              left: cursor.x,
              top: cursor.y,
              pointerEvents: "none",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16">
              <title>cursor</title>
              <path d="M0 0L12 8L6 9L4 15Z" fill="currentColor" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
