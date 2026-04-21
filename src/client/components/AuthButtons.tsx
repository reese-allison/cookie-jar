import { IS_DEV, signIn } from "../lib/auth-client";

// Without `callbackURL` better-auth redirects to its own baseURL (the API
// server origin) after OAuth, which has no root handler — users would land on
// "Cannot GET /". Sending them back to the client origin picks up the new
// session cookie and re-renders into the landing screen.
const clientCallback = typeof window !== "undefined" ? window.location.origin : "/";

export function AuthButtons() {
  return (
    <div className="auth-buttons">
      <button
        type="button"
        className="auth-button auth-button--google"
        onClick={() => signIn.social({ provider: "google", callbackURL: clientCallback })}
      >
        Sign in with Google
      </button>
      <button
        type="button"
        className="auth-button auth-button--discord"
        onClick={() => signIn.social({ provider: "discord", callbackURL: clientCallback })}
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
