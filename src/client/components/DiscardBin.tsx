import { forwardRef } from "react";

interface DiscardBinProps {
  isHighlighted: boolean;
}

export const DiscardBin = forwardRef<HTMLDivElement, DiscardBinProps>(function DiscardBin(
  { isHighlighted },
  ref,
) {
  return (
    <section
      ref={ref}
      className={`discard-bin ${isHighlighted ? "discard-bin--highlighted" : ""}`}
      aria-label="Discard bin"
    >
      <span className="discard-bin__icon" aria-hidden="true">
        🗑
      </span>
      <span className="discard-bin__label">Discard</span>
    </section>
  );
});
