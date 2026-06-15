import type { Note } from "@shared/types";
import { memo } from "react";
import { useRoomStore } from "../stores/roomStore";
import { CopyButton } from "./CopyButton";

interface PulledNoteProps {
  note: Note;
  showPulledBy?: boolean;
  showAuthors?: boolean;
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
  showAuthors,
  canDiscard = true,
  onDiscard,
  onReturn,
}: PulledNoteProps) {
  // Stable selector — confirms the copy via the app toast without threading a
  // prop down from RoomView through DraggablePulledNote.
  const setNotice = useRoomStore((s) => s.setNotice);
  return (
    <article className={`pulled-note pulled-note--${note.style}`} aria-label={`Note: ${note.text}`}>
      <p className="pulled-note__text">{note.text}</p>
      {note.url && (
        <a className="pulled-note__url" href={note.url} target="_blank" rel="noopener noreferrer">
          {note.url}
        </a>
      )}
      {showAuthors && note.authorDisplayName && (
        <p className="pulled-note__author">Written by {note.authorDisplayName}</p>
      )}
      {showPulledBy && note.pulledBy && (
        <p className="pulled-note__pulled-by">Pulled by {note.pulledBy}</p>
      )}
      <div className="pulled-note__actions">
        <CopyButton
          value={note.text}
          label="Copy note text"
          onCopied={() => setNotice("Copied!")}
        />
        <button
          type="button"
          className="btn--icon"
          onClick={() => onReturn(note.id)}
          aria-label="Return to jar"
          title="Return to jar"
        >
          {/* u-turn arrow — put the note back in the jar */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 15 3 9l6-6" />
            <path d="M3 9h12a6 6 0 0 1 0 12h-3" />
          </svg>
        </button>
        {canDiscard && (
          <button
            type="button"
            className="btn--icon pulled-note__discard"
            onClick={() => onDiscard(note.id)}
            aria-label="Discard"
            title="Discard"
          >
            {/* Feather "trash-2" */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        )}
      </div>
    </article>
  );
});
