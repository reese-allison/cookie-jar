import { IS_DEV, signIn } from "../lib/auth-client";

// Without `callbackURL` better-auth redirects to its own baseURL (the API
// server origin) after OAuth, which has no root handler — users would land on
// "Cannot GET /". We send them back to the *current* client URL — origin +
// path + query — not just the origin: a viewer who signs in from inside
// /ABCDEFG must return to /ABCDEFG (where an authed mount auto-joins), not the
// bare landing page. Read at click time, not module load, so client-side
// navigation (pushState into a room) is reflected.
function clientCallback(): string {
  if (typeof window === "undefined") return "/";
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}`;
}

export function AuthButtons() {
  return (
    <div className="auth-buttons">
      <button
        type="button"
        className="auth-button auth-button--google"
        onClick={() => signIn.social({ provider: "google", callbackURL: clientCallback() })}
      >
        Sign in with Google
      </button>
      <button
        type="button"
        className="auth-button auth-button--discord"
        onClick={() => signIn.social({ provider: "discord", callbackURL: clientCallback() })}
      >
        Sign in with Discord
      </button>
      {IS_DEV && (
        <button
          type="button"
          className="auth-button auth-button--anonymous"
          onClick={() => signIn.anonymous()}
          title="Dev only — disabled in production"
        >
          Continue anonymously (dev)
        </button>
      )}
    </div>
  );
}
