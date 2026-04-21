// ---- Note ----

export type NoteState = "in_jar" | "pulled" | "discarded";

export type NoteStyle = "sticky" | "index_card" | "napkin" | "parchment" | "fortune_cookie";

export interface Note {
  id: string;
  jarId: string;
  text: string;
  url?: string;
  style: NoteStyle;
  state: NoteState;
  authorId?: string;
  /** Author's display name at write time. Populated via LEFT JOIN in queries. */
  authorDisplayName?: string;
  pulledBy?: string;
  /**
   * Authed puller's user id. Set when the puller is signed in (OAuth or
   * anonymous dev session). Used server-side to disambiguate private-mode
   * filtering when two users share a display name. Anon pre-auth pulls and
   * rows from before the column existed leave this undefined.
   */
  pulledByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Jar ----

export type NoteVisibility = "open" | "sealed";
export type PullVisibility = "shared" | "private";
/**
 * What happens to a member's pulled notes when they disconnect or leave the
 * room. "return" flips them back to in_jar so someone else can pull them;
 * "discard" marks them discarded so they're out of rotation.
 */
export type OnLeaveBehavior = "return" | "discard";

/**
 * A jar's visual identity is two user-uploaded images (opened and closed states)
 * plus an optional background. This lets users make the "jar" anything they want —
 * a cookie jar, a cauldron, a treasure chest, a hat, whatever.
 */
export interface JarSoundPack {
  noteAdd?: string;
  notePull?: string;
  noteDiscard?: string;
  noteReturn?: string;
  userJoin?: string;
  userLeave?: string;
}

export interface JarAppearance {
  openedImageUrl?: string;
  closedImageUrl?: string;
  backgroundImageUrl?: string;
  label?: string;
  soundPack?: JarSoundPack;
}

export interface JarConfig {
  noteVisibility: NoteVisibility;
  pullVisibility: PullVisibility;
  sealedRevealCount: number;
  showAuthors: boolean;
  showPulledBy: boolean;
  /**
   * What to do with a member's pulled notes when they leave the room.
   * Defaults to "return" server-side so the jar re-fills; "discard" is for
   * games where leaving forfeits whatever you had on the table.
   */
  onLeaveBehavior: OnLeaveBehavior;
  /**
   * When true, `note:add` and `note:discard` are blocked for everyone
   * (including the owner). `note:pull` and `note:return` stay allowed. Owner
   * toggles from Jar Settings. Persists at the jar level — a fresh room for
   * a locked jar starts locked.
   */
  locked?: boolean;
  /**
   * Access restriction. If either list is non-empty, the jar is private to
   * the owner + anyone whose user id appears in `allowedUserIds` or whose
   * authenticated email (case-insensitive) appears in `allowedEmails`.
   * An empty or missing list means the default access rules apply
   * (isPublic / isTemplate unchanged).
   */
  allowedUserIds?: string[];
  allowedEmails?: string[];
}

export interface Jar {
  id: string;
  ownerId: string;
  name: string;
  appearance: JarAppearance;
  config: JarConfig;
  isTemplate: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Room ----

export type RoomState = "open" | "locked" | "closed";
export type UserRole = "owner" | "contributor" | "viewer";

export interface RoomMember {
  id: string;
  displayName: string;
  /** better-auth user id when signed in; undefined for truly anonymous sockets. */
  userId?: string;
  role: UserRole;
  color: string;
  connectedAt: string;
}

export interface Room {
  id: string;
  code: string;
  jarId: string;
  state: RoomState;
  maxParticipants: number;
  maxViewers: number;
  idleTimeoutMinutes: number;
  members: RoomMember[];
  createdAt: string;
}

// ---- User ----

export interface User {
  id: string;
  email: string;
  displayName: string;
  image?: string;
  createdAt: string;
}

// ---- Socket Events ----

export interface CursorPosition {
  x: number;
  y: number;
  userId: string;
}

export interface NoteStatePayload {
  inJarCount: number;
  // Omitted when the update is count-only (e.g., private-mode pulls by others).
  // Clients must preserve their existing pulledNotes when absent.
  pulledNotes?: Note[];
  jarName?: string;
  jarConfig?: JarConfig;
  jarAppearance?: JarAppearance;
  /** Sealed buffer length, so joiners and post-refresh clients can render "N/M sealed" accurately. */
  sealedCount?: number;
  sealedRevealAt?: number;
  /** Whether the viewer (a non-owner) has this jar starred. Sent on join; omitted on deltas. */
  isStarred?: boolean;
}

export interface ServerToClientEvents {
  "room:state": (room: Room) => void;
  "room:member_joined": (member: RoomMember) => void;
  "room:member_left": (memberId: string) => void;
  "cursor:moved": (cursor: CursorPosition) => void;
  "note:state": (state: NoteStatePayload) => void;
  "note:added": (note: Note, inJarCount: number) => void;
  "note:pulled": (note: Note, pulledBy: string) => void;
  "note:discarded": (noteId: string) => void;
  "note:returned": (noteId: string, inJarCount: number) => void;
  /** Single-note upsert. Clients merge by id rather than replacing the pulled list. */
  "note:updated": (note: Note) => void;
  "pull:rejected": (reason: string) => void;
  "note:sealed": (
    pulledBy: string,
    sealedCount: number,
    revealAt: number,
    inJarCount: number,
  ) => void;
  "note:reveal": (notes: Note[]) => void;
  "note:drag": (noteId: string, draggerId: string, mx: number, my: number) => void;
  "note:drag_end": (noteId: string, draggerId: string) => void;
  "room:error": (error: string) => void;
  "history:list": (entries: PullHistoryEntry[]) => void;
  /** Fired when the server rejects an event for exceeding its per-socket rate budget. */
  rate_limited: (event: string, retryInMs: number) => void;
  /** Fired when a long-lived socket's underlying session has expired. The socket will disconnect immediately afterwards. */
  "auth:expired": () => void;
}

export interface PullHistoryEntry {
  id: string;
  noteText: string;
  pulledBy: string;
  pulledAt: string;
}

export interface ClientToServerEvents {
  "room:join": (code: string, displayName: string) => void;
  "room:leave": () => void;
  "cursor:move": (position: Omit<CursorPosition, "userId">) => void;
  "note:add": (note: Pick<Note, "text" | "url" | "style">) => void;
  "note:pull": () => void;
  "note:discard": (noteId: string) => void;
  "note:return": (noteId: string) => void;
  "note:drag": (noteId: string, mx: number, my: number) => void;
  "note:drag_end": (noteId: string) => void;
  "history:get": () => void;
  "history:clear": () => void;
  "jar:refresh": () => void;
  /** Owner-only: return every currently pulled note to the jar. */
  "note:returnAll": () => void;
  /** Owner-only: discard every currently pulled note. */
  "note:discardAll": () => void;
}
