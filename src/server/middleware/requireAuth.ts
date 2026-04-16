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
