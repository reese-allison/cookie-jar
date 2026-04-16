import { animated } from "@react-spring/web";
import type { Note } from "@shared/types";
import type { Rect } from "../hooks/hitTest";
import { type DropTarget, useDragNote } from "../hooks/useDragNote";
import { PulledNote } from "./PulledNote";

interface DraggablePulledNoteProps {
  note: Note;
  showPulledBy?: boolean;
  onDiscard: (noteId: string) => void;
  onReturn: (noteId: string) => void;
  onHover: (target: DropTarget) => void;
  jarRect: React.RefObject<Rect | null>;
  discardRect: React.RefObject<Rect | null>;
}

export function DraggablePulledNote({
  note,
  showPulledBy,
  onDiscard,
  onReturn,
  onHover,
  jarRect,
  discardRect,
}: DraggablePulledNoteProps) {
  const { bind, style } = useDragNote({
    jarRect,
    discardRect,
    onDrop: (target) => {
      onHover(null);
      if (target === "jar") {
        onReturn(note.id);
      } else if (target === "discard") {
        onDiscard(note.id);
      }
    },
    onDragMove: (hovering) => {
      onHover(hovering);
    },
  });

  return (
    <animated.div
      {...bind()}
      className="draggable-pulled-note"
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
        onDiscard={onDiscard}
        onReturn={onReturn}
      />
    </animated.div>
  );
}
