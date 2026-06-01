import type {
  JarAppearance,
  JarConfig,
  Note,
  NoteStyle,
  PullHistoryEntry,
  Room,
} from "@shared/types";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import type { Rect } from "../hooks/hitTest";
import type { DropTarget } from "../hooks/useDragNote";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { CopyableRoomCode } from "./CopyableRoomCode";
import { DiscardBin } from "./DiscardBin";
import { DraggablePulledNote } from "./DraggablePulledNote";
import { Jar } from "./Jar";
import { NoteForm } from "./NoteForm";
import { PullHistory } from "./PullHistory";
import { RemoteCursors } from "./RemoteCursors";
import { SettingsButton, StarToggleButton } from "./RoomHeaderButtons";
import { RoomHeaderMenu } from "./RoomHeaderMenu";
import { SealedNoteStack } from "./SealedNoteStack";
import { SoundToggle } from "./SoundToggle";

// Drawer is lazy: it's only rendered when the owner opens the settings
// panel, and pulls in its own form-control surface area + image cropping
// helpers. Defer the chunk until the user actually opens it.
const JarSettingsDrawer = lazy(() =>
  import("./JarSettingsDrawer").then((m) => ({ default: m.JarSettingsDrawer })),
);

interface RoomViewProps {
  room: Room;
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
  // Once the user has opened settings, keep the lazy chunk mounted so its
  // close animation can play (unmounting the lazy boundary on close would
  // cut the animation off). The chunk only downloads the first time
  // `settingsOpen` flips true.
  const [settingsEverOpened, setSettingsEverOpened] = useState(false);
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
      <PullHistory entries={history} onRefresh={onGetHistory} onClear={onClearHistory} />
      {isOwner && (
        <SettingsButton
          onClick={() => {
            setSettingsEverOpened(true);
            setSettingsOpen(true);
          }}
        />
      )}
      {!isOwner && onToggleStar && (
        <StarToggleButton starred={isStarred === true} onToggle={onToggleStar} />
      )}
      <SoundToggle />
    </>
  );

  return (
    <div className="room-view">
      <header className="room-header">
        {jarName && <span className="room-jar-name">{jarName}</span>}
        <CopyableRoomCode code={room.shareCode} />
        {isNarrow ? (
          <div className="room-actions room-actions--collapsed">
            <RoomHeaderMenu>{actions}</RoomHeaderMenu>
          </div>
        ) : (
          <div className="room-actions">{actions}</div>
        )}
      </header>

      {isOwner && jarConfig && settingsEverOpened && (
        <Suspense fallback={null}>
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
        </Suspense>
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
              draggable={!isTouch}
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

        {/* Drag target is pointer-only — touch drag is unreliable (multi-touch
            gestures hijack it), so on coarse pointers we hide the bin and
            rely on the explicit Discard button on each pulled note. */}
        {canWrite && !isTouch && (
          <DiscardBin ref={discardRef} isHighlighted={hoverTarget === "discard"} />
        )}

        {/* Cursors subscribe at the leaf so 15-Hz peer packets don't re-render RoomView. */}
        <RemoteCursors members={room.members} hidden={isTouch} />
      </div>
    </div>
  );
}
