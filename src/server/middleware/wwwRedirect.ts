import type { NextFunction, Request, Response } from "express";

/**
 * Canonicalize the host: any incoming request to `www.<something>` 308s to
 * `https://<something><path>` so the OAuth flow only ever sees one origin.
 *
 * Why this exists: `BETTER_AUTH_URL` and `CLIENT_URL` are single values, so
 * the session cookie domain is pinned to whichever host we picked. A user
 * arriving on the www variant would either fail OAuth (cookie scope mismatch)
 * or sign in to a parallel session that doesn't follow them back to the apex.
 * One canonical host avoids both.
 *
 * Status 308 (not 301) preserves the request method — a 301 silently
 * downgrades POST to GET, which would break any future webhook or form on
 * the www host. OAuth callbacks happen to be GET so 301 would have worked
 * for the happy path, but 308 is the safer default.
 *
 * Always redirects over https because Fly's `force_https = true` already
 * upgrades http to https before requests reach app code; emitting a http
 * Location would trigger a second round-trip.
 */
export function wwwRedirect(req: Request, res: Response, next: NextFunction): void {
  const host = req.hostname;
  if (!host.startsWith("www.")) {
    next();
    return;
  }
  const apex = host.slice("www.".length);
  res.redirect(308, `https://${apex}${req.originalUrl}`);
}
