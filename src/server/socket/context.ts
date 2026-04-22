import type { JarConfig, UserRole } from "@shared/types";
import type { SocketAuthData } from "./authMiddleware";

export interface SocketContext {
  roomId: string | null;
  jarId: string | null;
  jarConfig: JarConfig | null;
  memberId: string | null;
  displayName: string | null;
  userId: string | null;
  /** Email from the session. Needed to evaluate jar allowlists. */
  email: string | null;
  /** Whether the provider has verified `email`. Required for allowlist matches. */
  emailVerified: boolean;
  isAuthenticated: boolean;
  role: UserRole | null;
}

export function createSocketContext(authData: SocketAuthData): SocketContext {
  return {
    roomId: null,
    jarId: null,
    jarConfig: null,
    memberId: null,
    displayName: authData.user?.displayName ?? null,
    userId: authData.user?.id ?? null,
    email: authData.user?.email ?? null,
    emailVerified: authData.user?.emailVerified === true,
    isAuthenticated: authData.user !== null,
    role: null,
  };
}
