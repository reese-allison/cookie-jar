import type { Express } from "express";
import helmet from "helmet";

// This is an API-only backend (Vite serves the client). CSP on JSON is mostly
// defense-in-depth, but keeping a strict "default-src 'none'" policy means any
// accidentally-embedded HTML response can't run scripts. COOP is left permissive
// so OAuth popup flows don't get broken cross-window messaging.
export function applySecurityHeaders(app: Express): void {
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginOpenerPolicy: false,
      // Static sound assets are loaded cross-origin from the client app.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
}
