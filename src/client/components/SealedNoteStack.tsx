interface SealedNoteStackProps {
  count: number;
  revealAt: number;
}

/**
 * Visual placeholder for notes that have been pulled in sealed mode but
 * aren't yet revealed. Gives the room a concrete signal ("2 of 3 drawn")
 * instead of pulls silently disappearing until the threshold is hit.
 */
export function SealedNoteStack({ count, revealAt }: SealedNoteStackProps) {
  if (count <= 0) return null;

  const remaining = Math.max(0, revealAt - count);
  return (
    <div className="sealed-stack" aria-live="polite">
      <div className="sealed-stack__cards" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: decorative stack, order is the identity
          <div key={i} className="sealed-card" style={{ "--i": i } as React.CSSProperties}>
            <svg viewBox="0 0 48 56" className="sealed-card__svg" aria-hidden="true">
              <title>Sealed note</title>
              {/* Paper body */}
              <rect
                x="2"
                y="4"
                width="44"
                height="48"
                rx="3"
                fill="#fef9c3"
                stroke="#d9c47a"
                strokeWidth="1"
              />
              {/* Fold lines suggesting a folded note */}
              <line x1="2" y1="20" x2="46" y2="20" stroke="#d9c47a" strokeWidth="0.6" />
              <line x1="2" y1="36" x2="46" y2="36" stroke="#d9c47a" strokeWidth="0.6" />
              {/* Wax seal */}
              <circle cx="24" cy="28" r="5" fill="#c67b5c" />
              <circle cx="24" cy="28" r="2.2" fill="#b5651d" />
            </svg>
          </div>
        ))}
      </div>
      <p className="sealed-stack__label">
        <strong>{count}</strong> of <strong>{revealAt}</strong> drawn
        {remaining > 0 && ` — ${remaining} more to reveal`}
      </p>
    </div>
  );
}
