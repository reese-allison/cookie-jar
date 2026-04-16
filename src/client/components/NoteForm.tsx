import type { NoteStyle } from "@shared/types";
import { useState } from "react";

interface NoteFormSubmission {
  text: string;
  url?: string;
  style: NoteStyle;
}

interface NoteFormProps {
  onSubmit: (note: NoteFormSubmission) => void;
  disabled: boolean;
}

export function NoteForm({ onSubmit, disabled }: NoteFormProps) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const note: NoteFormSubmission = {
      text: trimmedText,
      style: "sticky",
    };
    if (url.trim()) {
      note.url = url.trim();
    }
    onSubmit(note);
    setText("");
    setUrl("");
  };

  return (
    <form className="note-form" onSubmit={handleSubmit}>
      <textarea
        className="note-form__text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a note..."
        maxLength={500}
        disabled={disabled}
      />
      <input
        type="url"
        className="note-form__url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL (optional)"
        disabled={disabled}
      />
      <button type="submit" className="note-form__submit" disabled={disabled || !text.trim()}>
        Add to Jar
      </button>
    </form>
  );
}
