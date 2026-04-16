interface CursorProps {
  x: number;
  y: number;
  displayName: string;
  color: string;
}

export function Cursor({ x, y, displayName, color }: CursorProps) {
  return (
    <div
      className="cursor"
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" style={{ color }}>
        <title>{`${displayName}'s cursor`}</title>
        <path d="M0 0L12 8L6 9L4 15Z" fill="currentColor" />
      </svg>
      <span
        className="cursor__label"
        style={{
          backgroundColor: color,
          color: "#fff",
          fontSize: "11px",
          padding: "1px 6px",
          borderRadius: "4px",
          whiteSpace: "nowrap",
          marginLeft: "4px",
          position: "relative",
          top: "-2px",
        }}
      >
        {displayName}
      </span>
    </div>
  );
}
