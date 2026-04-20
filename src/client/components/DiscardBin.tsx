import { forwardRef } from "react";

interface DiscardBinProps {
  isHighlighted: boolean;
}

/**
 * Viewport-pinned trash can. Sits bottom-right of the screen regardless of
 * how the room-scene flows, so hit-testing while dragging stays consistent.
 */
export const DiscardBin = forwardRef<HTMLDivElement, DiscardBinProps>(function DiscardBin(
  { isHighlighted },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`discard-bin ${isHighlighted ? "discard-bin--highlighted" : ""}`}
      aria-label="Discard"
      role="img"
    >
      <svg
        className="discard-bin__icon"
        viewBox="0 0 64 80"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>Discard</title>
        {/* Lid handle */}
        <rect x="26" y="4" width="12" height="4" rx="1.5" fill="currentColor" opacity="0.9" />
        {/* Lid */}
        <rect x="6" y="10" width="52" height="8" rx="2" fill="currentColor" opacity="0.9" />
        {/* Can body — slightly tapered */}
        <path
          d="M 10 20 L 54 20 L 51 74 Q 51 78 47 78 L 17 78 Q 13 78 13 74 Z"
          fill="currentColor"
          fillOpacity="0.12"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinejoin="round"
        />
        {/* Vertical ribs */}
        <line
          x1="24"
          y1="28"
          x2="23"
          y2="70"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="32"
          y1="28"
          x2="32"
          y2="70"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="40"
          y1="28"
          x2="41"
          y2="70"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
});
