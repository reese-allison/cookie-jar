import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins/anonymous";
import pg from "pg";
import { buildPoolConfig } from "./db/pool";
import { logger } from "./logger";

// Separate pool so an auth stampede can't starve app queries. Small max since
// auth volume is much lower than app traffic.
export const authPool = new pg.Pool({ ...buildPoolConfig(), max: 5 });

/**
 * Anonymous sign-in is gated to *explicit* dev/test environments only.
 * Production, staging, previews, and ambiguous states (env unset, custom
 * names like "prod") all fail closed — enabling anon on those surfaces
 * would let anyone mint a session.
 */
export function shouldEnableAnonPlugin(env: string | undefined): boolean {
  return env === "development" || env === "test";
}

/**
 * Resolve the better-auth session-signing secret. Falls back to a
 * well-known dev string only when NODE_ENV is explicitly "development"
 * or "test". An unset NODE_ENV is treated as prod-like and *must* set
 * BETTER_AUTH_SECRET — otherwise a misconfigured deploy would sign
 * sessions with a public fallback.
 */
export function resolveAuthSecret(
  env: string | undefined,
  secret: string | undefined,
  warn: (msg: string) => void = () => {},
): string {
  if (secret) return secret;
  if (env === "development" || env === "test") {
    if (env !== "test") {
      warn(
        "BETTER_AUTH_SECRET unset — falling back to the well-known dev secret. " +
          "Set BETTER_AUTH_SECRET before exposing this server.",
      );
    }
    return "dev-only-secret-not-for-production";
  }
  throw new Error(
    `BETTER_AUTH_SECRET must be set when NODE_ENV="${env ?? "(unset)"}". ` +
      "Only NODE_ENV=development (with a local secret) or NODE_ENV=test may omit it.",
  );
}

const devPlugins = shouldEnableAnonPlugin(process.env.NODE_ENV)
  ? [
      anonymous({
        // Our users table is snake_case; override the plugin's default camelCase column.
        schema: { user: { fields: { isAnonymous: "is_anonymous" } } },
      }),
    ]
  : [];
if (shouldEnableAnonPlugin(process.env.NODE_ENV)) {
  logger.warn("anonymous sign-in enabled (POST /api/auth/sign-in/anonymous)");
}

export const auth = betterAuth({
  database: authPool,
  plugins: devPlugins,
  // Our schema uses UUID columns for all id PKs; generate UUIDs instead of the
  // default nanoid strings better-auth would otherwise pass to them.
  advanced: {
    database: {
      generateId: () => randomUUID(),
    },
  },
  secret: resolveAuthSecret(process.env.NODE_ENV, process.env.BETTER_AUTH_SECRET, (msg) =>
    logger.warn(msg),
  ),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  trustedOrigins: [process.env.CLIENT_URL ?? "http://localhost:5175"],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
    },
  },
  user: {
    modelName: "users",
    fields: {
      name: "display_name",
      email: "email",
      emailVerified: "email_verified",
      image: "image",
      createdAt: "created_at",
      updatedAt: "updated_at",
      isAnonymous: "is_anonymous",
    },
  },
  session: {
    modelName: "sessions",
    fields: {
      userId: "user_id",
      token: "token",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  account: {
    modelName: "accounts",
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      scope: "scope",
      idToken: "id_token",
      password: "password",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "verifications",
    fields: {
      identifier: "identifier",
      value: "value",
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
});
