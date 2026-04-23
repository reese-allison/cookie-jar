import { useCallback, useEffect, useRef, useState } from "react";

interface CopyableRoomCodeProps {
  code: string;
  className?: string;
}

function buildRoomUrl(code: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/${code}`;
}

export function CopyableRoomCode({ code, className = "room-code" }: CopyableRoomCodeProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleClick = useCallback(() => {
    navigator.clipboard?.writeText(buildRoomUrl(code)).catch(() => {});
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [code]);

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      aria-label={`Copy room link for ${code}`}
      title="Click to copy room link"
    >
      <span className="room-code__value">{code}</span>
      {copied && (
        <span className="room-code__copied" role="status">
          Copied!
        </span>
      )}
    </button>
  );
}
