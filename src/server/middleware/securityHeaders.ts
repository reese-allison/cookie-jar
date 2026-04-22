import type { Express } from "express";
import helmet from "helmet";

/**
 * CSP policy covers two deploy shapes:
 *
 *   1. Same-origin deploy (Fly single-VM, any VPS): Express serves both the
 *      built client bundle AND the API. Connect/script/style/img all need
 *      'self' plus allowances for user-provided jar assets.
 *   2. API-only deploy (Vite serves the client on a separate origin): the
 *      client never actually loads HTML from this origin, so CSP here is
 *      defense-in-depth for any accidentally-embedded response.
 *
 * `defaultSrc 'none'` means any directive we *don't* list explicitly falls
 * through to "block everything", so every source we actually want has to
 * be named here. Script-src stays strict — 'self' only, no external CDNs
 * and no inline scripts (Vite emits external chunks with content hashes
 * so inline isn't needed).
 *
 * `img-src` + `media-src` include `https:` because a jar's appearance /
 * sound pack is *owner-hosted* at any URL they choose (Imgur, CDN, their
 * own host). Without `https:`, custom jars would fail to render.
 *
 * COOP is left permissive so OAuth popup flows don't get broken
 * cross-window messaging.
 */
export function applySecurityHeaders(app: Express): void {
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'self'"],
          scriptSrc: ["'self'"],
          // index.html loads a Google Fonts stylesheet from fonts.googleapis.com,
          // so styleSrc must include https:. 'unsafe-inline' covers Vite's
          // dev-time inline styles and any component-level inline style attrs.
          styleSrc: ["'self'", "'unsafe-inline'", "https:"],
          imgSrc: ["'self'", "data:", "https:"],
          // Font files themselves come from fonts.gstatic.com (https:).
          fontSrc: ["'self'", "data:", "https:"],
          // fetch() to /api, WebSocket (ws:/wss:) to /socket.io, both same-origin.
          connectSrc: ["'self'", "ws:", "wss:"],
          // User-provided jar sound packs are owner-hosted at arbitrary URLs.
          mediaSrc: ["'self'", "https:"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginOpenerPolicy: false,
      // Static sound assets are loaded cross-origin from the client app.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
}
