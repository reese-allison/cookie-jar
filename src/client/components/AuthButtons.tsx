import { IS_DEV, signIn } from "../lib/auth-client";

export function AuthButtons() {
  return (
    <div className="auth-buttons">
      <button
        type="button"
        className="auth-button auth-button--google"
        onClick={() => signIn.social({ provider: "google" })}
      >
        Sign in with Google
      </button>
      <button
        type="button"
        className="auth-button auth-button--discord"
        onClick={() => signIn.social({ provider: "discord" })}
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
