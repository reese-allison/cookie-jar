import type { Note } from "@shared/types";

interface PulledNoteProps {
  note: Note;
  onDiscard: (noteId: string) => void;
  onReturn: (noteId: string) => void;
}

export function PulledNote({ note, onDiscard, onReturn }: PulledNoteProps) {
  return (
    <div className="pulled-note">
      <p className="pulled-note__text">{note.text}</p>
      {note.url && (
        <a className="pulled-note__url" href={note.url} target="_blank" rel="noopener noreferrer">
          {note.url}
        </a>
      )}
      <div className="pulled-note__actions">
        <button type="button" onClick={() => onReturn(note.id)} aria-label="Return to jar">
          Return
        </button>
        <button type="button" onClick={() => onDiscard(note.id)} aria-label="Discard">
          Discard
        </button>
      </div>
    </div>
  );
}
