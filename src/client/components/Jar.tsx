interface JarProps {
  noteCount: number;
  isLocked: boolean;
  onPull: () => void;
  isHighlighted?: boolean;
}

export function Jar({ noteCount, isLocked, onPull, isHighlighted = false }: JarProps) {
  const isEmpty = noteCount === 0;

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
        <div className="jar__image" />
        <span className="jar__count">{noteCount}</span>
      </button>
      {isLocked && <span className="jar__lock-indicator">Locked</span>}
    </div>
  );
}
