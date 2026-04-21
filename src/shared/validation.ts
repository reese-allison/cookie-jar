import { MAX_NOTE_URL_LENGTH, NOTE_STYLES, ROOM_CODE_CHARS, ROOM_CODE_LENGTH } from "./constants";
import type { NoteStyle } from "./types";

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((char) => ROOM_CODE_CHARS.includes(char));
}

export function isValidNoteText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 500;
}

export function isValidUrl(url: string): boolean {
  // Match the DB CHECK on notes.url so invalid input fails at the API, not
  // the database. MAX_NOTE_URL_LENGTH is generous — OAuth return URLs and
  // pre-signed S3 URLs routinely run ~1 KB.
  if (url.length > MAX_NOTE_URL_LENGTH) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function generateRoomCode(): string {
  const array = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(array);
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[array[i] % ROOM_CODE_CHARS.length];
  }
  return code;
}

export function isValidDisplayName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 30;
}

export type ParsedNoteInput = { text: string; url?: string; style: NoteStyle };
export type NoteInputResult = { ok: true; note: ParsedNoteInput } | { ok: false; error: string };

/**
 * Single source of truth for `note:add` input validation. Both the REST POST
 * /api/notes route and the socket `note:add` handler run user input through
 * this so validation can't drift. Style defaults to "sticky" — it's purely
 * a visual choice, not worth failing the whole request over.
 */
export function parseNoteInput(input: unknown): NoteInputResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Note payload must be an object" };
  }
  const obj = input as { text?: unknown; url?: unknown; style?: unknown };
  if (typeof obj.text !== "string" || !isValidNoteText(obj.text)) {
    return { ok: false, error: "Note text must be 1-500 characters" };
  }
  let url: string | undefined;
  if (obj.url !== undefined && obj.url !== null && obj.url !== "") {
    if (typeof obj.url !== "string" || !isValidUrl(obj.url)) {
      return { ok: false, error: "Invalid URL" };
    }
    url = obj.url;
  }
  const style: NoteStyle = NOTE_STYLES.includes(obj.style as NoteStyle)
    ? (obj.style as NoteStyle)
    : "sticky";
  return { ok: true, note: { text: obj.text.trim(), url, style } };
}

const APPEARANCE_URL_FIELDS = ["openedImageUrl", "closedImageUrl", "backgroundImageUrl"] as const;
const SOUND_PACK_KEYS = [
  "noteAdd",
  "notePull",
  "noteDiscard",
  "noteReturn",
  "userJoin",
  "userLeave",
] as const;

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

function cleanUrl(v: unknown): string | null | "skip" {
  if (isEmpty(v)) return "skip";
  if (typeof v !== "string" || !isValidUrl(v)) return null;
  return v;
}

function sanitizeSoundPack(input: unknown): Record<string, string> | null {
  if (typeof input !== "object" || input === null) return null;
  const pack = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of SOUND_PACK_KEYS) {
    const parsed = cleanUrl(pack[key]);
    if (parsed === null) return null;
    if (parsed === "skip") continue;
    out[key] = parsed;
  }
  return out;
}

function collectAppearanceUrls(
  obj: Record<string, unknown>,
  out: Record<string, unknown>,
): boolean {
  for (const field of APPEARANCE_URL_FIELDS) {
    const parsed = cleanUrl(obj[field]);
    if (parsed === null) return false;
    if (parsed !== "skip") out[field] = parsed;
  }
  return true;
}

/**
 * Validate and normalize a user-supplied `JarAppearance`. Returns the cleaned
 * shape or null if anything fails. URL fields must be http(s) — this is what
 * keeps `javascript:` URLs from ending up in `<img src>` or `fetch()`.
 */
export function sanitizeJarAppearance(input: unknown): Record<string, unknown> | null {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (!collectAppearanceUrls(obj, out)) return null;
  if (!isEmpty(obj.label)) {
    if (typeof obj.label !== "string" || obj.label.length > 100) return null;
    out.label = obj.label;
  }
  if (obj.soundPack !== undefined && obj.soundPack !== null) {
    const pack = sanitizeSoundPack(obj.soundPack);
    if (!pack) return null;
    out.soundPack = pack;
  }
  return out;
}

const NOTE_VISIBILITIES = ["open", "sealed"] as const;
const PULL_VISIBILITIES = ["shared", "private"] as const;
const ON_LEAVE_BEHAVIORS = ["return", "discard"] as const;

type CheckResult = { ok: true; value: unknown } | { ok: false };

function checkEnum<T extends readonly string[]>(v: unknown, allowed: T): CheckResult {
  if (typeof v !== "string" || !allowed.includes(v as T[number])) return { ok: false };
  return { ok: true, value: v };
}

function checkIntBounded(v: unknown, min: number, max: number): CheckResult {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return { ok: false };
  return { ok: true, value: v };
}

function checkBoolean(v: unknown): CheckResult {
  if (typeof v !== "boolean") return { ok: false };
  return { ok: true, value: v };
}

// Basic email shape check — mirrors what better-auth stores. We deliberately
// don't get cute with the RFC spec (that regex is 6 KB); the worst case of a
// typo'd entry is "person can't join until owner fixes it."
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Realistic ceiling — protects the jar config row size and keeps the UI from
// trying to render a list of thousands.
const MAX_ALLOWLIST_ENTRIES = 200;

function checkEmailList(v: unknown): CheckResult {
  if (!Array.isArray(v)) return { ok: false };
  if (v.length > MAX_ALLOWLIST_ENTRIES) return { ok: false };
  const seen = new Set<string>();
  for (const entry of v) {
    if (typeof entry !== "string") return { ok: false };
    const normalized = entry.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) return { ok: false };
    seen.add(normalized);
  }
  // Return deduped, normalized list — callers persist whatever we return.
  return { ok: true, value: Array.from(seen) };
}

function checkUserIdList(v: unknown): CheckResult {
  if (!Array.isArray(v)) return { ok: false };
  if (v.length > MAX_ALLOWLIST_ENTRIES) return { ok: false };
  const seen = new Set<string>();
  for (const entry of v) {
    if (typeof entry !== "string" || !UUID_RE.test(entry)) return { ok: false };
    seen.add(entry);
  }
  return { ok: true, value: Array.from(seen) };
}

/**
 * Validate and normalize a user-supplied `JarConfig`. Numeric fields are
 * clamped — an owner can't set a 2-billion-note reveal threshold to trip
 * server code that assumes reasonable bounds.
 */
export function sanitizeJarConfig(input: unknown): Record<string, unknown> | null {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const fields: Array<[string, () => CheckResult]> = [
    ["noteVisibility", () => checkEnum(obj.noteVisibility, NOTE_VISIBILITIES)],
    ["pullVisibility", () => checkEnum(obj.pullVisibility, PULL_VISIBILITIES)],
    ["sealedRevealCount", () => checkIntBounded(obj.sealedRevealCount, 1, 1000)],
    ["showAuthors", () => checkBoolean(obj.showAuthors)],
    ["showPulledBy", () => checkBoolean(obj.showPulledBy)],
    ["onLeaveBehavior", () => checkEnum(obj.onLeaveBehavior, ON_LEAVE_BEHAVIORS)],
    ["locked", () => checkBoolean(obj.locked)],
    ["allowedUserIds", () => checkUserIdList(obj.allowedUserIds)],
    ["allowedEmails", () => checkEmailList(obj.allowedEmails)],
  ];

  for (const [key, check] of fields) {
    if (obj[key] === undefined) continue;
    const result = check();
    if (!result.ok) return null;
    out[key] = result.value;
  }
  return out;
}
