// Icon buttons for the room header (star + settings). Extracted from RoomView
// so its ~50 lines of static SVG path data don't bloat that component; the
// icons are otherwise self-contained presentational buttons.

export function StarToggleButton({
  starred,
  onToggle,
}: {
  starred: boolean;
  onToggle: () => void;
}) {
  const label = starred ? "Unstar this jar" : "Star this jar";
  // Heroicons v2 — filled star when starred, outline when not. Same viewBox
  // as the other header icons so the sizing is consistent.
  const path = starred
    ? "M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L10 18.354 5.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006Z"
    : "M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z";
  return (
    <button
      type="button"
      className="btn--icon"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={starred}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <path
          fill={starred ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={starred ? 0 : 1.5}
          d={path}
        />
      </svg>
    </button>
  );
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn--icon"
      onClick={onClick}
      aria-label="Jar settings"
      title="Jar settings"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        {/* Heroicons v2 solid cog-6-tooth — evenodd fill rule creates the
            center hole; without it the icon reads as a solid blob. */}
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        />
      </svg>
    </button>
  );
}
