import type { JarAppearance } from "@shared/types";

interface JarProps {
  noteCount: number;
  isLocked: boolean;
  onPull: () => void;
  isHighlighted?: boolean;
  appearance?: JarAppearance;
}

export function Jar({ noteCount, isLocked, onPull, isHighlighted = false, appearance }: JarProps) {
  const isEmpty = noteCount === 0;
  const imageUrl = isLocked ? appearance?.closedImageUrl : appearance?.openedImageUrl;

  return (
    <div
      className={`jar ${isLocked ? "jar--locked" : ""} ${isHighlighted ? "jar--highlighted" : ""}`}
    >
      <button
        type="button"
        className="jar__body"
        onClick={onPull}
        disabled={isLocked || isEmpty}
        aria-label={isEmpty ? "Jar is empty" : `Pull from jar (${noteCount} notes)`}
      >
        {imageUrl ? (
          <img className="jar__custom-image" src={imageUrl} alt="Jar" />
        ) : (
          <div className="jar__image" />
        )}
        <span className="jar__count">{noteCount}</span>
      </button>
      {appearance?.label && <span className="jar__label">{appearance.label}</span>}
      {isLocked && <span className="jar__lock-indicator">Locked</span>}
    </div>
  );
}
