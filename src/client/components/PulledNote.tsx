import type { Note } from "@shared/types";

interface PulledNoteProps {
  note: Note;
  showPulledBy?: boolean;
  onDiscard: (noteId: string) => void;
  onReturn: (noteId: string) => void;
}

export function PulledNote({ note, showPulledBy, onDiscard, onReturn }: PulledNoteProps) {
  return (
    <article className="pulled-note" aria-label={`Note: ${note.text}`}>
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
        <button type="button" onClick={() => onDiscard(note.id)} aria-label="Discard">
          Discard
        </button>
      </div>
    </article>
  );
}
