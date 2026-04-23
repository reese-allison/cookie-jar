// Default limits (configurable per-jar or per-room)
export const DEFAULT_LIMITS = {
  maxParticipants: 20,
  maxViewers: 50,
} as const;

// Hard caps — prevent a single jar from DoS'ing a pod. These are server-side
// enforced on both note:add and bulk-import. Configurable later if per-tier
// limits become a thing, but baseline values have to be finite.
export const MAX_NOTES_PER_JAR = 1000;
export const MAX_BULK_IMPORT = 500;
// Cap on GET /api/notes/export. listNotesByJar is unfiltered (includes
// discarded + historical pulls), so even a well-behaved jar can accumulate
// well past MAX_NOTES_PER_JAR over its lifetime. Hard ceiling keeps the
// response bounded and the Express buffer predictable.
export const MAX_EXPORT_NOTES = 5000;
export const MAX_NOTE_TEXT_LENGTH = 500;
export const MAX_NOTE_URL_LENGTH = 2000;
export const MAX_DISPLAY_NAME_LENGTH = 30;

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
