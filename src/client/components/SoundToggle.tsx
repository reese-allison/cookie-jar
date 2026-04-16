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
      className="sound-toggle"
      onClick={toggle}
      aria-label={enabled ? "Mute sounds" : "Unmute sounds"}
      title={enabled ? "Sounds on" : "Sounds off"}
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}
