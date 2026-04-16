// Default limits (configurable per-jar or per-room)
export const DEFAULT_LIMITS = {
  maxParticipants: 20,
  maxViewers: 50,
} as const;

// Room settings
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I/O/1/0 to avoid confusion
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;

// Real-time
export const CURSOR_BROADCAST_INTERVAL_MS = 66; // ~15fps

// Note styles
export const NOTE_STYLES = [
  "sticky",
  "index_card",
  "napkin",
  "parchment",
  "fortune_cookie",
] as const;

// Default jar config
export const DEFAULT_JAR_CONFIG = {
  noteVisibility: "open",
  sealedRevealCount: 1,
  showAuthors: false,
} as const;
