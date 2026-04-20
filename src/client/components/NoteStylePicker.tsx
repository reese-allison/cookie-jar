import { NOTE_STYLES } from "@shared/constants";
import type { NoteStyle } from "@shared/types";

interface NoteStylePickerProps {
  value: NoteStyle;
  onChange: (value: NoteStyle) => void;
}

const LABELS: Record<NoteStyle, string> = {
  sticky: "Sticky",
  index_card: "Index card",
  napkin: "Napkin",
  parchment: "Parchment",
  fortune_cookie: "Fortune",
};

export function NoteStylePicker({ value, onChange }: NoteStylePickerProps) {
  return (
    <div className="note-style-picker" role="radiogroup" aria-label="Note style">
      {NOTE_STYLES.map((style) => {
        const selected = style === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA composite radiogroup pattern — visual tiles need the button base
          <button
            type="button"
            key={style}
            role="radio"
            aria-checked={selected}
            aria-label={LABELS[style]}
            tabIndex={selected ? 0 : -1}
            className={`note-style-tile note-style-tile--${style}${
              selected ? " note-style-tile--selected" : ""
            }`}
            onClick={() => onChange(style)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                const idx = NOTE_STYLES.indexOf(value);
                onChange(NOTE_STYLES[(idx - 1 + NOTE_STYLES.length) % NOTE_STYLES.length]);
              } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const idx = NOTE_STYLES.indexOf(value);
                onChange(NOTE_STYLES[(idx + 1) % NOTE_STYLES.length]);
              }
            }}
          >
            <span className="note-style-tile__sample" aria-hidden="true">
              Aa
            </span>
            <span className="note-style-tile__label">{LABELS[style]}</span>
          </button>
        );
      })}
    </div>
  );
}
