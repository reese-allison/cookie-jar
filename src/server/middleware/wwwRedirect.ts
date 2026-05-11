import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Build a middleware that 308s `www.<apex>` to `https://<apex><path>` so the
 * OAuth flow only ever sees one origin. Bound to a single apex on purpose:
 * an earlier version reflected `req.hostname` directly into the Location
 * header, which would let an attacker setting `Host: www.evil.com` open-
 * redirect a victim. With the apex pinned at startup, any unexpected Host
 * just falls through.
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
export function buildWwwRedirect(apex: string): RequestHandler {
  const wwwHost = `www.${apex}`;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.hostname !== wwwHost) {
      next();
      return;
    }
    res.redirect(308, `https://${apex}${req.originalUrl}`);
  };
}
