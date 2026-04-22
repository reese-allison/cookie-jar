import { animated, useSpring } from "@react-spring/web";
import type { Note } from "@shared/types";
import { memo, useEffect } from "react";
import type { Rect } from "../hooks/hitTest";
import { type DropTarget, useDragNote } from "../hooks/useDragNote";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { useNoteStore } from "../stores/noteStore";
import { PulledNote } from "./PulledNote";

interface DraggablePulledNoteProps {
  note: Note;
  showPulledBy?: boolean;
  showAuthors?: boolean;
  /** When false, Discard is hidden and drag-to-discard is disabled. */
  canDiscard?: boolean;
  /**
   * When false, no drag handlers are attached — the note is a static element.
   * Peer-drag mirroring still works so other users' drags animate correctly.
   * RoomView flips this off on touch devices where drag is unreliable.
   */
  draggable?: boolean;
  onDiscard: (noteId: string) => void;
  onReturn: (noteId: string) => void;
  onHover: (target: DropTarget) => void;
  onDragNote: (noteId: string, mx: number, my: number) => void;
  onDragNoteEnd: (noteId: string) => void;
  jarRect: React.RefObject<Rect | null>;
  discardRect: React.RefObject<Rect | null>;
}

// Memoized — RoomView re-renders on cursor/room changes, but each dragged
// note's render only depends on its own note object, the drag callbacks, and
// whether a peer is currently dragging it. Shallow compare handles that.
// peerDrag is read from the store directly so a drag-tick on one note only
// re-renders that note, not every sibling.
export const DraggablePulledNote = memo(function DraggablePulledNote({
  note,
  showPulledBy,
  showAuthors,
  canDiscard = true,
  draggable = true,
  onDiscard,
  onReturn,
  onHover,
  onDragNote,
  onDragNoteEnd,
  jarRect,
  discardRect,
}: DraggablePulledNoteProps) {
  const peerDrag = useNoteStore((s) => s.peerDrags.get(note.id));
  const isPeerDragging = peerDrag !== undefined;

  const { bind, style, isDragging } = useDragNote({
    enabled: draggable && !isPeerDragging,
    jarRect,
    discardRect,
    onDrop: (target) => {
      onHover(null);
      if (target === "jar") {
        onReturn(note.id);
      } else if (target === "discard" && canDiscard) {
        onDiscard(note.id);
      }
    },
    onDragMove: (hovering) => {
      onHover(hovering);
    },
    onDragPositionChange: (mx, my) => {
      onDragNote(note.id, mx, my);
    },
    onDragEnd: () => {
      onDragNoteEnd(note.id);
    },
  });

  const reduceMotion = useReducedMotion();

  // Separate spring to mirror a peer's drag smoothly.
  const [peerStyle, peerApi] = useSpring(() => ({
    x: 0,
    y: 0,
    config: { tension: 300, friction: 30 },
  }));

  useEffect(() => {
    if (peerDrag) {
      // Snap instantly — peer-drag packets arrive at ~15fps; any spring
      // tween between them visibly lags behind the dragger.
      peerApi.start({ x: peerDrag.mx, y: peerDrag.my, immediate: true });
    } else {
      // Snap back to origin without animation in reduced-motion mode.
      peerApi.start({ x: 0, y: 0, immediate: reduceMotion });
    }
  }, [peerDrag, peerApi, reduceMotion]);

  if (isPeerDragging) {
    return (
      <animated.div
        className="draggable-pulled-note draggable-pulled-note--peer-dragging"
        style={{
          x: peerStyle.x,
          y: peerStyle.y,
          pointerEvents: "none",
          touchAction: "none",
        }}
      >
        <PulledNote
          note={note}
          showPulledBy={showPulledBy}
          showAuthors={showAuthors}
          canDiscard={canDiscard}
          onDiscard={onDiscard}
          onReturn={onReturn}
        />
      </animated.div>
    );
  }

  // Static render for touch devices: no drag bind, no grab cursor, default
  // touch-action so vertical scrolling inside the notes area still works.
  if (!draggable) {
    return (
      <div className="draggable-pulled-note">
        <PulledNote
          note={note}
          showPulledBy={showPulledBy}
          showAuthors={showAuthors}
          canDiscard={canDiscard}
          onDiscard={onDiscard}
          onReturn={onReturn}
        />
      </div>
    );
  }

  return (
    <animated.div
      {...bind()}
      className={`draggable-pulled-note${isDragging ? " draggable-pulled-note--dragging" : ""}`}
      style={{
        x: style.x,
        y: style.y,
        rotate: style.rotate.to((r) => `${r}deg`),
        scale: style.scale,
        touchAction: "none",
        cursor: "grab",
      }}
    >
      <PulledNote
        note={note}
        showPulledBy={showPulledBy}
        showAuthors={showAuthors}
        canDiscard={canDiscard}
        onDiscard={onDiscard}
        onReturn={onReturn}
      />
    </animated.div>
  );
});
