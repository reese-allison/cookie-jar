import type { JarAppearance } from "@shared/types";
import { DefaultJarSvg } from "./DefaultJarSvg";

interface JarProps {
  noteCount: number;
  /** Visual lid state only (closed when the room is locked). */
  isLocked: boolean;
  /** Whether the user can pull. Locked rooms still allow pulling. */
  canPull: boolean;
  onPull: () => void;
  isHighlighted?: boolean;
  appearance?: JarAppearance;
}

export function Jar({
  noteCount,
  isLocked,
  canPull,
  onPull,
  isHighlighted = false,
  appearance,
}: JarProps) {
  const isEmpty = noteCount === 0;
  const disabled = !canPull || isEmpty;
  // When locked, display the closed-lid art regardless of uploaded images.
  const imageUrl = isLocked ? appearance?.closedImageUrl : appearance?.openedImageUrl;
  const label = isEmpty ? "Jar is empty" : `Pull from jar (${noteCount} notes)`;

  return (
    <div
      className={`jar ${isLocked ? "jar--locked" : ""} ${isHighlighted ? "jar--highlighted" : ""}`}
    >
      <button
        type="button"
        className="jar__body"
        onClick={onPull}
        disabled={disabled}
        aria-label={label}
      >
        <div className="jar__svg-wrap">
          {imageUrl ? (
            <img className="jar__custom-image" src={imageUrl} alt="" />
          ) : (
            <DefaultJarSvg isOpen={!isLocked} />
          )}
          <span className="jar__count" aria-hidden="true">
            {noteCount}
          </span>
        </div>
      </button>
      {appearance?.label && <span className="jar__label">{appearance.label}</span>}
    </div>
  );
}
