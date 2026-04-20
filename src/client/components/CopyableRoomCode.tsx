import { useCallback, useEffect, useRef, useState } from "react";

interface CopyableRoomCodeProps {
  code: string;
}

export function CopyableRoomCode({ code }: CopyableRoomCodeProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleClick = useCallback(() => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [code]);

  return (
    <button
      type="button"
      className="room-code"
      onClick={handleClick}
      aria-label={`Copy room code ${code}`}
      title="Click to copy"
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
