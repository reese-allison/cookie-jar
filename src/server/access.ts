import type { Jar } from "@shared/types";

interface AccessViewer {
  /** better-auth user id, or null for anonymous. */
  userId: string | null;
  /** Email on the signed-in session, if known. */
  email: string | null;
  /**
   * Whether the provider has verified this email belongs to the signed-in
   * user. OAuth-issued sessions (Google, Discord) arrive verified; an
   * email+password signup is not verified until the user confirms.
   * Required for `allowedEmails` matches — otherwise anyone could register
   * `alice@example.com` (unverified) and step into an allowlisted jar.
   */
  emailVerified: boolean;
}

/**
 * Single source of truth for "can this viewer act on this jar?". Covers the
 * read path (GET /api/jars/:id, the non-owner jar name lookup for stars) and
 * the join path (socket room:join). Write paths (edit, delete, bulk import)
 * are still owner-only — see the ownerId === viewer check in each route.
 *
 * Rules, in order:
 *   1. Owner always wins.
 *   2. Public or template jars are open to everyone.
 *   3. If the jar has an allowlist (userIds OR emails non-empty), only
 *      matching viewers are allowed. This is how "private with invites"
 *      is modeled — a private jar without an allowlist is still
 *      owner-only (the legacy default).
 *   4. Otherwise, deny.
 *
 * Emails compare case-insensitively; the sanitizer already stores them
 * lowercased, so this is a belt-and-suspenders .toLowerCase() on the viewer.
 * Email matches additionally require `emailVerified` to be true — an
 * unverified signup cannot satisfy an email allowlist.
 */
export function canAccessJar(jar: Jar, viewer: AccessViewer): boolean {
  if (viewer.userId && jar.ownerId === viewer.userId) return true;
  if (jar.isPublic || jar.isTemplate) return true;

  const allowedIds = jar.config?.allowedUserIds ?? [];
  const allowedEmails = jar.config?.allowedEmails ?? [];
  if (allowedIds.length === 0 && allowedEmails.length === 0) return false;

  if (viewer.userId && allowedIds.includes(viewer.userId)) return true;
  if (viewer.emailVerified && viewer.email && allowedEmails.includes(viewer.email.toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * Whether `viewer` is allowed to join a room for `jar`. Looser than
 * canAccessJar — reflects the historical "if you have the code, you can
 * join" model, which is what the owner shares on `Copy room code`. The
 * allowlist *tightens* this: once set, joining becomes owner-or-allowlisted
 * only. Without an allowlist a private jar is still joinable by anyone
 * with a valid code.
 */
export function canJoinJar(jar: Jar, viewer: AccessViewer): boolean {
  if (canAccessJar(jar, viewer)) return true;
  const hasAllowlist =
    (jar.config?.allowedUserIds ?? []).length > 0 || (jar.config?.allowedEmails ?? []).length > 0;
  return !hasAllowlist;
}
