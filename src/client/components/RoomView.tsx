import type { CursorPosition, Note, NoteStyle, Room } from "@shared/types";
import { Jar } from "./Jar";
import { NoteForm } from "./NoteForm";
import { PulledNote } from "./PulledNote";

interface RoomViewProps {
  room: Room;
  cursors: Map<string, CursorPosition>;
  inJarCount: number;
  pulledNotes: Note[];
  isAdding: boolean;
  onMouseMove: (x: number, y: number) => void;
  onLock: () => void;
  onUnlock: () => void;
  onLeave: () => void;
  onAddNote: (note: { text: string; url?: string; style: NoteStyle }) => void;
  onPull: () => void;
  onDiscard: (noteId: string) => void;
  onReturn: (noteId: string) => void;
}

export function RoomView({
  room,
  cursors,
  inJarCount,
  pulledNotes,
  isAdding,
  onMouseMove,
  onLock,
  onUnlock,
  onLeave,
  onAddNote,
  onPull,
  onDiscard,
  onReturn,
}: RoomViewProps) {
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onMouseMove(e.clientX - rect.left, e.clientY - rect.top);
  };

  const isLocked = room.state === "locked";

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
        <Jar noteCount={inJarCount} isLocked={isLocked} onPull={onPull} />

        <div className="pulled-notes">
          {pulledNotes.map((note) => (
            <PulledNote key={note.id} note={note} onDiscard={onDiscard} onReturn={onReturn} />
          ))}
        </div>

        {!isLocked && <NoteForm onSubmit={onAddNote} disabled={isAdding} />}

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
