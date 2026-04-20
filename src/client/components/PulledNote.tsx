import type { Note } from "@shared/types";
import { memo } from "react";

interface PulledNoteProps {
  note: Note;
  showPulledBy?: boolean;
  /** When false, the Discard button is hidden (e.g. the room is locked). */
  canDiscard?: boolean;
  onDiscard: (noteId: string) => void;
  onReturn: (noteId: string) => void;
}

// Memoized — the parent (RoomView) re-renders on room/cursor state changes,
// but a pulled note's visual only depends on the note itself + the two
// callbacks. Shallow prop compare is correct here.
export const PulledNote = memo(function PulledNote({
  note,
  showPulledBy,
  canDiscard = true,
  onDiscard,
  onReturn,
}: PulledNoteProps) {
  return (
    <article className={`pulled-note pulled-note--${note.style}`} aria-label={`Note: ${note.text}`}>
      <p className="pulled-note__text">{note.text}</p>
      {note.url && (
        <a className="pulled-note__url" href={note.url} target="_blank" rel="noopener noreferrer">
          {note.url}
        </a>
      )}
      {showPulledBy && note.pulledBy && (
        <p className="pulled-note__pulled-by">Pulled by {note.pulledBy}</p>
      )}
      <div className="pulled-note__actions">
        <button type="button" onClick={() => onReturn(note.id)} aria-label="Return to jar">
          Return
        </button>
        {canDiscard && (
          <button type="button" onClick={() => onDiscard(note.id)} aria-label="Discard">
            Discard
          </button>
        )}
      </div>
    </article>
  );
});
