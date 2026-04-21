import type {
  CursorPosition,
  JarAppearance,
  JarConfig,
  Note,
  NoteStyle,
  PullHistoryEntry,
  Room,
} from "@shared/types";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Rect } from "../hooks/hitTest";
import type { DropTarget } from "../hooks/useDragNote";
import { useMediaQuery } from "../hooks/useMediaQuery";
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
  showAuthors: boolean;
  jarAppearance?: JarAppearance;
  jarConfig?: JarConfig;
  jarName?: string;
  sealedCount: number;
  sealedRevealAt: number;
  onMouseMove: (x: number, y: number) => void;
  onLeave: () => void;
  onJarRefresh: () => void;
  onAddNote: (note: { text: string; url?: string; style: NoteStyle }) => void;
  onPull: () => void;
  onDiscard: (noteId: string) => void;
  onReturn: (noteId: string) => void;
  onReturnAll?: () => void;
  onDiscardAll?: () => void;
  onDragNote: (noteId: string, mx: number, my: number) => void;
  onDragNoteEnd: (noteId: string) => void;
  history: PullHistoryEntry[];
  onGetHistory: () => void;
  onClearHistory?: () => void;
  /** Opens the global sign-in modal from the viewer-only affordance. */
  onSignIn?: () => void;
  /** True when the viewer has this jar starred. Always false for owners. */
  isStarred?: boolean;
  /** Star / unstar callback. Omitted for owners (who don't star their own jars). */
  onToggleStar?: () => void;
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
  showAuthors,
  jarAppearance,
  jarConfig,
  jarName,
  sealedCount,
  sealedRevealAt,
  onMouseMove,
  onLeave,
  onJarRefresh,
  onAddNote,
  onPull,
  onDiscard,
  onReturn,
  onReturnAll,
  onDiscardAll,
  onDragNote,
  onDragNoteEnd,
  history,
  onGetHistory,
  onClearHistory,
  onSignIn,
  isStarred,
  onToggleStar,
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

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      onMouseMove(e.clientX - rect.left, e.clientY - rect.top);
    },
    [onMouseMove],
  );

  // Build a members-by-id lookup once per members change. Without this, every
  // cursor packet would trigger N × M `.find` calls (N peers × M members) as
  // the cursors Map updates re-render this component.
  const memberById = useMemo(() => {
    const map = new Map<string, (typeof room.members)[number]>();
    for (const m of room.members) map.set(m.id, m);
    return map;
  }, [room.members]);

  // Locked lives on jarConfig now; "read-mostly" means contributors can
  // still pull/return but add and discard are blocked. Viewers can't
  // interact regardless.
  const isLocked = jarConfig?.locked === true;
  const canPull = !isViewer;
  const canWrite = !isViewer && !isLocked; // adding + discarding

  const actions = (
    <>
      <button type="button" className="btn--ghost" onClick={onLeave}>
        Leave
      </button>
      {!isOwner && onToggleStar && (
        <StarToggleButton starred={isStarred === true} onToggle={onToggleStar} />
      )}
      <PullHistory entries={history} onRefresh={onGetHistory} onClear={onClearHistory} />
      {isOwner && <SettingsButton onClick={() => setSettingsOpen(true)} />}
      <SoundToggle />
    </>
  );

  return (
    <div className="room-view">
      <header className="room-header">
        {jarName && <span className="room-jar-name">{jarName}</span>}
        <CopyableRoomCode code={room.code} />
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
          pulledNoteCount={pulledNotes.length}
          onSaved={onJarRefresh}
          onReturnAll={onReturnAll}
          onDiscardAll={onDiscardAll}
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
              showAuthors={showAuthors}
              canDiscard={canWrite}
              onDiscard={onDiscard}
              onReturn={onReturn}
              onHover={handleHover}
              onDragNote={onDragNote}
              onDragNoteEnd={onDragNoteEnd}
              jarRect={jarRect}
              discardRect={discardRect}
            />
          ))}
        </div>

        {canWrite && <NoteForm onSubmit={onAddNote} disabled={isAdding} />}

        {isViewer && (
          <button type="button" className="viewer-notice" onClick={onSignIn}>
            Sign in to participate
          </button>
        )}

        {canWrite && <DiscardBin ref={discardRef} isHighlighted={hoverTarget === "discard"} />}

        {/* Remote cursors — hidden on touch devices where users have no pointer */}
        {!isTouch &&
          [...cursors.entries()].map(([userId, cursor]) => {
            const member = memberById.get(userId);
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

function StarToggleButton({ starred, onToggle }: { starred: boolean; onToggle: () => void }) {
  const label = starred ? "Unstar this jar" : "Star this jar";
  // Heroicons v2 — filled star when starred, outline when not. Same viewBox
  // as the other header icons so the sizing is consistent.
  const path = starred
    ? "M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L10 18.354 5.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006Z"
    : "M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z";
  return (
    <button
      type="button"
      className="btn--icon"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={starred}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path
          fill={starred ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={starred ? 0 : 1.5}
          d={path}
        />
      </svg>
    </button>
  );
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn--icon"
      onClick={onClick}
      aria-label="Jar settings"
      title="Jar settings"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        {/* Heroicons v2 solid cog-6-tooth — evenodd fill rule creates the
            center hole; without it the icon reads as a solid blob. */}
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        />
      </svg>
    </button>
  );
}
