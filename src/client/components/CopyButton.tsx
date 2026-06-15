interface CopyButtonProps {
  /** The text written to the clipboard on click. */
  value: string;
  /** Accessible label / tooltip, e.g. "Copy note text". */
  label: string;
  /** Called after a successful clipboard write (e.g. to show a toast). */
  onCopied?: () => void;
}

/**
 * Small reusable button that copies `value` to the clipboard. The optional
 * chain mirrors CopyableRoomCode: `navigator.clipboard` is undefined in
 * insecure contexts / older browsers, where the click is a no-op rather than a
 * throw. `onCopied` fires only on a successful write so callers can confirm.
 */
export function CopyButton({ value, label, onCopied }: CopyButtonProps) {
  const handleCopy = () => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => onCopied?.())
      .catch(() => {});
  };

  return (
    <button
      type="button"
      className="btn--icon"
      onClick={handleCopy}
      aria-label={label}
      title={label}
    >
      {/* Feather "copy" — two overlapping cards, the universal copy-to-clipboard glyph. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    </button>
  );
}
