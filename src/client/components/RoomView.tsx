import type {
  CursorPosition,
  JarAppearance,
  Note,
  NoteStyle,
  PullHistoryEntry,
  Room,
} from "@shared/types";
import { useCallback, useRef, useState } from "react";
import type { Rect } from "../hooks/hitTest";
import type { DropTarget } from "../hooks/useDragNote";
import { Cursor } from "./Cursor";
import { DiscardBin } from "./DiscardBin";
import { DraggablePulledNote } from "./DraggablePulledNote";
import { Jar } from "./Jar";
import { NoteForm } from "./NoteForm";
import { PullHistory } from "./PullHistory";
import { SoundToggle } from "./SoundToggle";

interface RoomViewProps {
  room: Room;
  cursors: Map<string, CursorPosition>;
  inJarCount: number;
  pulledNotes: Note[];
  isAdding: boolean;
  isViewer: boolean;
  showPulledBy: boolean;
  jarAppearance?: JarAppearance;
  onMouseMove: (x: number, y: number) => void;
  onLock: () => void;
  onUnlock: () => void;
  onLeave: () => void;
  onAddNote: (note: { text: string; url?: string; style: NoteStyle }) => void;
  onPull: () => void;
  onDiscard: (noteId: string) => void;
  onReturn: (noteId: string) => void;
  history: PullHistoryEntry[];
  onGetHistory: () => void;
  onClearHistory?: () => void;
}

export function RoomView({
  room,
  cursors,
  inJarCount,
  pulledNotes,
  isAdding,
  isViewer,
  showPulledBy,
  jarAppearance,
  onMouseMove,
  onLock,
  onUnlock,
  onLeave,
  onAddNote,
  onPull,
  onDiscard,
  onReturn,
  history,
  onGetHistory,
  onClearHistory,
}: RoomViewProps) {
  const jarRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const jarRect = useRef<Rect | null>(null);
  const discardRect = useRef<Rect | null>(null);
  const [hoverTarget, setHoverTarget] = useState<DropTarget>(null);

  // Update rects on drag start — we capture once per drag rather than on every frame
  const updateRects = useCallback(() => {
    if (jarRef.current) {
      const r = jarRef.current.getBoundingClientRect();
      jarRect.current = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    if (discardRef.current) {
      const r = discardRef.current.getBoundingClientRect();
      discardRect.current = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onMouseMove(e.clientX - rect.left, e.clientY - rect.top);
  };

  const isLocked = room.state === "locked";
  const canInteract = !isViewer && !isLocked;

  return (
    <div className="room-view">
      <header className="room-header">
        <span className="room-code">{room.code}</span>
        <span className="room-state">{room.state}</span>
        <div className="room-actions">
          {!isViewer && room.state === "open" && (
            <button type="button" onClick={onLock}>
              Lock
            </button>
          )}
          {!isViewer && room.state === "locked" && (
            <button type="button" onClick={onUnlock}>
              Unlock
            </button>
          )}
          <button type="button" onClick={onLeave}>
            Leave
          </button>
        </div>
        <PullHistory entries={history} onRefresh={onGetHistory} onClear={onClearHistory} />
        <SoundToggle />
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
        <div ref={jarRef}>
          <Jar
            noteCount={inJarCount}
            isLocked={!canInteract}
            onPull={onPull}
            isHighlighted={hoverTarget === "jar"}
            appearance={jarAppearance}
          />
        </div>

        <div className="pulled-notes">
          {pulledNotes.map((note) => (
            <DraggablePulledNote
              key={note.id}
              note={note}
              showPulledBy={showPulledBy}
              onDiscard={onDiscard}
              onReturn={onReturn}
              onHover={(target) => {
                updateRects();
                setHoverTarget(target);
              }}
              jarRect={jarRect}
              discardRect={discardRect}
            />
          ))}
        </div>

        {canInteract && <NoteForm onSubmit={onAddNote} disabled={isAdding} />}

        {isViewer && <p className="viewer-notice">Sign in to participate</p>}

        {canInteract && <DiscardBin ref={discardRef} isHighlighted={hoverTarget === "discard"} />}

        {/* Remote cursors */}
        {[...cursors.entries()].map(([userId, cursor]) => {
          const member = room.members.find((m) => m.id === userId);
          if (!member) return null;
          return (
            <Cursor
              key={userId}
              x={cursor.x}
              y={cursor.y}
              displayName={member.displayName}
              color={member.color}
            />
          );
        })}
      </div>
    </div>
  );
}
