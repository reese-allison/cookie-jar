import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins/anonymous";
import pg from "pg";
import { buildPoolConfig } from "./db/pool";
import { logger } from "./logger";

// Separate pool so an auth stampede can't starve app queries. Small max since
// auth volume is much lower than app traffic.
export const authPool = new pg.Pool({ ...buildPoolConfig(), max: 5 });

// Anonymous sign-in is dev-only. In production we require a real OAuth provider.
const isDev = process.env.NODE_ENV !== "production";
const devPlugins = isDev
  ? [
      anonymous({
        // Our users table is snake_case; override the plugin's default camelCase column.
        schema: { user: { fields: { isAnonymous: "is_anonymous" } } },
      }),
    ]
  : [];
if (isDev) {
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
  secret: (() => {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret && process.env.NODE_ENV === "production") {
      throw new Error("BETTER_AUTH_SECRET must be set in production");
    }
    if (!secret && process.env.NODE_ENV !== "test") {
      // Staging / dev-on-real-infra deploys forget NODE_ENV all the time. The
      // fallback secret is public in this repo, so sessions signed with it are
      // trivially forgeable. Make the warning loud enough to catch in logs.
      logger.warn(
        "BETTER_AUTH_SECRET unset — falling back to the well-known dev secret. " +
          "Set BETTER_AUTH_SECRET before exposing this server.",
      );
    }
    return secret ?? "dev-only-secret-not-for-production";
  })(),
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
