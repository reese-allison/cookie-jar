import { useState } from "react";
import { soundManager } from "../lib/sounds";

export function SoundToggle() {
  const [enabled, setEnabled] = useState(soundManager.isEnabled());

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    soundManager.setEnabled(next);
  };

  return (
    <button
      type="button"
      className="btn--icon sound-toggle"
      onClick={toggle}
      aria-label={enabled ? "Mute sounds" : "Unmute sounds"}
      aria-pressed={!enabled}
      title={enabled ? "Sounds on" : "Sounds off"}
    >
      {enabled ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <line x1="22" y1="9" x2="16" y2="15" />
          <line x1="16" y1="9" x2="22" y2="15" />
        </svg>
      )}
    </button>
  );
}
