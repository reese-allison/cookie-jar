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
      className="copy-button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
    >
      Copy
    </button>
  );
}
