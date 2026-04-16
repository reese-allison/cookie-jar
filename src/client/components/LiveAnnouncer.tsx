import { useEffect, useRef, useState } from "react";

/**
 * Screen reader live announcer. Call announce() to push a message
 * that will be read by assistive technology.
 */
export function useLiveAnnouncer() {
  const [message, setMessage] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const announce = (text: string) => {
    // Clear then set to force re-announcement of identical messages
    setMessage("");
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setMessage(text), 50);
  };

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return { message, announce };
}

interface LiveAnnouncerProps {
  message: string;
}

export function LiveAnnouncer({ message }: LiveAnnouncerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {message}
    </div>
  );
}
