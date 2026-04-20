interface DefaultJarSvgProps {
  isOpen: boolean;
}

/**
 * Clear-glass jar silhouette — no cookies inside, no box around it.
 * Acts as the whole clickable surface; the note count overlays the body.
 */
export function DefaultJarSvg({ isOpen }: DefaultJarSvgProps) {
  return (
    <svg
      viewBox="0 0 200 240"
      className="default-jar-svg"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <title>Jar</title>
      <defs>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,253,245,0.92)" />
          <stop offset="45%" stopColor="rgba(255,250,232,0.72)" />
          <stop offset="100%" stopColor="rgba(212,196,166,0.85)" />
        </linearGradient>
        <linearGradient id="lid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d9965f" />
          <stop offset="50%" stopColor="#c67b5c" />
          <stop offset="100%" stopColor="#8c4a2f" />
        </linearGradient>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="100" cy="224" rx="60" ry="5" fill="rgba(45,45,45,0.18)" />

      {/* Jar body — narrow neck, bulged middle, inset base */}
      <path
        d="
          M 70 70
          C 60 78 52 92 52 110
          L 52 190
          C 52 208 62 218 74 220
          L 126 220
          C 138 218 148 208 148 190
          L 148 110
          C 148 92 140 78 130 70
          L 130 62
          L 70 62
          Z
        "
        fill="url(#glass)"
        stroke="#a8926a"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Glass highlight on the left curve */}
      <path
        d="M 62 100 C 58 142 60 188 68 208"
        stroke="#ffffff"
        strokeOpacity="0.65"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      {/* Fainter right highlight */}
      <path
        d="M 138 118 C 141 148 141 176 136 200"
        stroke="#ffffff"
        strokeOpacity="0.25"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />

      {/* Rim of the jar */}
      <rect x="66" y="54" width="68" height="12" rx="2" fill="#e6d4a8" stroke="#a8926a" />
      <line x1="68" y1="60" x2="132" y2="60" stroke="#a8926a" strokeWidth="0.6" />

      {/*
        Lid geometry is identical across states — only the transform differs.
        Local coords: x centered at 0; y=0 is where the lid sits on the rim;
        negative y goes UP through the lid body and knob.
          Lid body rect: 84 × 16       x:[-42, 42], y:[-16, 0]
          Lid top ellipse:             cx=0, cy=-16, rx=42, ry=5
          Knob rect: 20 × 14           x:[-10, 10], y:[-30, -16]
          Knob top ellipse:            cx=0, cy=-30, rx=10, ry=3
        Closed: lid sits on the rim center (rim top y=54, so y=58 is 4px down
        into the rim — looks correctly "seated").
        Open: lid lifted and tilted to the right. Anchor y=54 so the lid's
        bottom sits right at the rim-top height (no floating gap) and tilts
        to the right of center.
      */}
      <g transform={isOpen ? "translate(138 54) rotate(24)" : "translate(100 58)"}>
        <rect x="-42" y="-16" width="84" height="16" rx="3" fill="url(#lid)" stroke="#6b3820" />
        <ellipse cx="0" cy="-16" rx="42" ry="5" fill="#e3a775" stroke="#6b3820" />
        <rect x="-10" y="-30" width="20" height="14" rx="3" fill="#b5651d" stroke="#6b3820" />
        <ellipse cx="0" cy="-30" rx="10" ry="3" fill="#d9965f" stroke="#6b3820" />
      </g>
    </svg>
  );
}
