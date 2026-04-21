import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../auth";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

// Narrows req.user after requireAuth has run. Throws if called without the middleware
// (caught by the route's try/catch and returned as 500, which is correct for this bug).
export function getUser(req: AuthenticatedRequest): AuthUser {
  if (!req.user) throw new Error("requireAuth middleware not applied");
  return req.user;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image ?? undefined,
    };

    next();
  } catch {
    res.status(401).json({ error: "Authentication required" });
  }
}

// better-auth's session cookie is named "<prefix>.session_token" where the
// default prefix is "better-auth". Narrow the short-circuit so unrelated
// cookies (analytics, LB affinity, consent banners) don't force us to hit
// auth for every anonymous request.
const SESSION_COOKIE_PATTERN = /(^|;\s*)[^=]*session_token=/;

/**
 * Populates `req.user` if a valid session cookie is present but never rejects
 * the request. Use on endpoints that are readable by anyone but where the
 * owner should see more (e.g. private jars).
 *
 * Short-circuits when the request has no session cookie — skips the
 * better-auth session lookup entirely for anonymous callers, which dominates
 * traffic on public routes. Unrelated cookies don't trigger the lookup.
 */
export async function attachUser(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader || !SESSION_COOKIE_PATTERN.test(cookieHeader)) {
    next();
    return;
  }
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (session?.user) {
      req.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image ?? undefined,
      };
    }
  } catch {
    // Fall through — unauth'd is a valid state for these routes.
  }
  next();
}
