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
  pulledBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Jar ----

export type NoteVisibility = "open" | "sealed";
export type PullVisibility = "shared" | "private";

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
  pullCounts?: Record<string, number>;
  jarConfig?: JarConfig;
  jarAppearance?: JarAppearance;
}

export interface ServerToClientEvents {
  "room:state": (room: Room) => void;
  "room:member_joined": (member: RoomMember) => void;
  "room:member_left": (memberId: string) => void;
  "room:locked": () => void;
  "room:unlocked": () => void;
  "cursor:moved": (cursor: CursorPosition) => void;
  "note:state": (state: NoteStatePayload) => void;
  "note:added": (note: Note, inJarCount: number) => void;
  "note:pulled": (note: Note, pulledBy: string) => void;
  "note:discarded": (noteId: string) => void;
  "note:returned": (noteId: string, inJarCount: number) => void;
  "pull:rejected": (reason: string) => void;
  "note:sealed": (
    pulledBy: string,
    sealedCount: number,
    revealAt: number,
    inJarCount: number,
  ) => void;
  "note:reveal": (notes: Note[]) => void;
  "room:error": (error: string) => void;
  "history:list": (entries: PullHistoryEntry[]) => void;
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
  "room:lock": () => void;
  "room:unlock": () => void;
  "cursor:move": (position: Omit<CursorPosition, "userId">) => void;
  "note:add": (note: Pick<Note, "text" | "url" | "style">) => void;
  "note:pull": () => void;
  "note:discard": (noteId: string) => void;
  "note:return": (noteId: string) => void;
  "history:get": () => void;
  "history:clear": () => void;
}
