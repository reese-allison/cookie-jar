import type {
  CursorPosition,
  JarAppearance,
  JarConfig,
  Note,
  NoteStyle,
  PullHistoryEntry,
  Room,
} from "@shared/types";
import { useCallback, useRef, useState } from "react";
import type { Rect } from "../hooks/hitTest";
import type { DropTarget } from "../hooks/useDragNote";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { PeerDrag } from "../stores/noteStore";
import { CopyableRoomCode } from "./CopyableRoomCode";
import { Cursor } from "./Cursor";
import { DiscardBin } from "./DiscardBin";
import { DraggablePulledNote } from "./DraggablePulledNote";
import { Jar } from "./Jar";
import { JarSettingsDrawer } from "./JarSettingsDrawer";
import { NoteForm } from "./NoteForm";
import { PullHistory } from "./PullHistory";
import { RoomHeaderMenu } from "./RoomHeaderMenu";
import { SealedNoteStack } from "./SealedNoteStack";
import { SoundToggle } from "./SoundToggle";

interface RoomViewProps {
  room: Room;
  cursors: Map<string, CursorPosition>;
  inJarCount: number;
  pulledNotes: Note[];
  isAdding: boolean;
  isViewer: boolean;
  isOwner: boolean;
  showPulledBy: boolean;
  jarAppearance?: JarAppearance;
  jarConfig?: JarConfig;
  jarName?: string;
  sealedCount: number;
  sealedRevealAt: number;
  peerDrags: Map<string, PeerDrag>;
  onMouseMove: (x: number, y: number) => void;
  onLock: () => void;
  onUnlock: () => void;
  onLeave: () => void;
  onJarRefresh: () => void;
  onAddNote: (note: { text: string; url?: string; style: NoteStyle }) => void;
  onPull: () => void;
  onDiscard: (noteId: string) => void;
  onReturn: (noteId: string) => void;
  onDragNote: (noteId: string, mx: number, my: number) => void;
  onDragNoteEnd: (noteId: string) => void;
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
  isOwner,
  showPulledBy,
  jarAppearance,
  jarConfig,
  jarName,
  sealedCount,
  sealedRevealAt,
  peerDrags,
  onMouseMove,
  onLock,
  onUnlock,
  onLeave,
  onJarRefresh,
  onAddNote,
  onPull,
  onDiscard,
  onReturn,
  onDragNote,
  onDragNoteEnd,
  history,
  onGetHistory,
  onClearHistory,
}: RoomViewProps) {
  const jarRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const jarRect = useRef<Rect | null>(null);
  const discardRect = useRef<Rect | null>(null);
  const [hoverTarget, setHoverTarget] = useState<DropTarget>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isTouch = useMediaQuery("(pointer: coarse)");
  const isNarrow = useMediaQuery("(max-width: 640px)");

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

  // Stable identity so memoized DraggablePulledNote doesn't re-render just
  // because RoomView rerendered.
  const handleHover = useCallback(
    (target: DropTarget) => {
      updateRects();
      setHoverTarget(target);
    },
    [updateRects],
  );

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onMouseMove(e.clientX - rect.left, e.clientY - rect.top);
  };

  const isLocked = room.state === "locked";
  // Locked means "read-mostly" — contributors can still pull/return, but
  // add and discard are blocked. Viewers can't interact regardless.
  const canPull = !isViewer;
  const canWrite = !isViewer && !isLocked; // adding + discarding

  const actions = (
    <>
      {isOwner && room.state === "open" && (
        <button type="button" onClick={onLock}>
          Lock
        </button>
      )}
      {isOwner && room.state === "locked" && (
        <button type="button" onClick={onUnlock}>
          Unlock
        </button>
      )}
      {isOwner && (
        <button
          type="button"
          className="room-settings-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Jar settings"
          title="Jar settings"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
            {/* Heroicons v2 solid cog-6-tooth — evenodd fill rule is what
                creates the center hole; without it the icon reads as a blob. */}
            <path
              fill="currentColor"
              fillRule="evenodd"
              clipRule="evenodd"
              d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
            />
          </svg>
        </button>
      )}
      <button type="button" onClick={onLeave}>
        Leave
      </button>
      <PullHistory entries={history} onRefresh={onGetHistory} onClear={onClearHistory} />
      <SoundToggle />
    </>
  );

  return (
    <div className="room-view">
      <header className="room-header">
        {jarName && <span className="room-jar-name">{jarName}</span>}
        <CopyableRoomCode code={room.code} />
        {room.state === "locked" && <span className="room-state">Locked</span>}
        {isNarrow ? (
          <div className="room-actions room-actions--collapsed">
            <RoomHeaderMenu>{actions}</RoomHeaderMenu>
          </div>
        ) : (
          <div className="room-actions">{actions}</div>
        )}
      </header>

      {isOwner && jarConfig && (
        <JarSettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          jarId={room.jarId}
          name={jarName ?? ""}
          appearance={jarAppearance ?? {}}
          config={jarConfig}
          onSaved={onJarRefresh}
        />
      )}

      <div className="room-members">
        <h2>Members ({room.members.length})</h2>
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
            isLocked={isLocked}
            canPull={canPull}
            onPull={onPull}
            isHighlighted={hoverTarget === "jar"}
            appearance={jarAppearance}
          />
        </div>

        {inJarCount === 0 && pulledNotes.length === 0 && sealedCount === 0 && canWrite && (
          <p className="empty-state">This jar is empty — add your first note below!</p>
        )}

        <SealedNoteStack count={sealedCount} revealAt={sealedRevealAt} />

        <div className="pulled-notes">
          {pulledNotes.map((note) => (
            <DraggablePulledNote
              key={note.id}
              note={note}
              showPulledBy={showPulledBy}
              canDiscard={canWrite}
              onDiscard={onDiscard}
              onReturn={onReturn}
              onHover={handleHover}
              onDragNote={onDragNote}
              onDragNoteEnd={onDragNoteEnd}
              peerDrag={peerDrags.get(note.id)}
              jarRect={jarRect}
              discardRect={discardRect}
            />
          ))}
        </div>

        {canWrite && <NoteForm onSubmit={onAddNote} disabled={isAdding} />}

        {isViewer && <p className="viewer-notice">Sign in to participate</p>}

        {canWrite && <DiscardBin ref={discardRef} isHighlighted={hoverTarget === "discard"} />}

        {/* Remote cursors — hidden on touch devices where users have no pointer */}
        {!isTouch &&
          [...cursors.entries()].map(([userId, cursor]) => {
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
