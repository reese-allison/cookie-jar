import { fromNodeHeaders } from "better-auth/node";
import type { Socket } from "socket.io";
import { auth } from "../auth";

export interface SocketAuthData {
  user: {
    id: string;
    displayName: string;
    email: string;
    image?: string;
  } | null;
  /**
   * Unix ms timestamp of when the underlying session expires. Set when we
   * resolve a real session at handshake. Anonymous or unauth'd sockets leave
   * this undefined. Used by the session-expiry checker to kick stale sockets.
   */
  sessionExpiresAt?: number;
}

/**
 * Socket.io middleware that verifies the session cookie from the handshake.
 * Authenticated users get their user data attached to socket.data.
 * Anonymous connections are allowed but flagged with user = null.
 */
export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
      (socket.data as SocketAuthData).user = null;
      next();
      return;
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders({ cookie: cookieHeader }),
    });

    if (session?.user) {
      const data = socket.data as SocketAuthData;
      data.user = {
        id: session.user.id,
        displayName: session.user.name,
        email: session.user.email,
        image: session.user.image ?? undefined,
      };
      const expiresAt = session.session?.expiresAt;
      if (expiresAt) {
        data.sessionExpiresAt = new Date(expiresAt).getTime();
      }
    } else {
      (socket.data as SocketAuthData).user = null;
    }

    next();
  } catch {
    // Auth failure doesn't reject the connection — user is treated as anonymous
    (socket.data as SocketAuthData).user = null;
    next();
  }
}
