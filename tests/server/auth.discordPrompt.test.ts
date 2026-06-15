import { beforeAll, describe, expect, it } from "vitest";

// `auth.ts` reads each provider's client id from the environment at
// module-eval time, so a dummy Discord client id must be present BEFORE the
// auth module is imported (done via the dynamic import in beforeAll). `||=`
// also overrides an empty-string value from a loaded .env.
process.env.DISCORD_CLIENT_ID ||= "test-discord-client-id";
process.env.DISCORD_CLIENT_SECRET ||= "test-discord-secret";
process.env.GOOGLE_CLIENT_ID ||= "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ||= "test-google-secret";

type AuthModule = typeof import("../../src/server/auth");
let auth: AuthModule["auth"];

beforeAll(async () => {
  ({ auth } = await import("../../src/server/auth"));
});

async function authorizeUrl(provider: "discord" | "google"): Promise<string> {
  const res = await auth.api.signInSocial({
    body: { provider, callbackURL: "http://localhost:5173/ABCDEF" },
  });
  if (typeof res.url !== "string") {
    throw new Error(`expected an authorize URL for ${provider}, got ${JSON.stringify(res)}`);
  }
  return res.url;
}

describe("Discord OAuth authorize URL", () => {
  // Regression guard for the iPhone sign-in failure. better-auth's Discord
  // provider defaults the authorize URL to `prompt=none`, which is documented
  // to break Discord's iOS in-app browser — completing the OAuth redirect with
  // `prompt=none` leaves the Discord iOS app unresponsive (discord-api-docs
  // #6160). Cookie Jar links are opened inside the Discord iOS app, so this
  // breaks Discord sign-in on iPhone while Google (no prompt param) works.
  // `prompt=consent` is Discord's normal behavior and omits the bad parameter.
  it("does not send prompt=none (it breaks Discord's iOS in-app browser, #6160)", async () => {
    const url = await authorizeUrl("discord");
    expect(url).not.toContain("prompt=none");
  });

  it("sends prompt=consent (Discord's normal flow) instead", async () => {
    const url = await authorizeUrl("discord");
    expect(url).toContain("prompt=consent");
  });
});

describe("Google OAuth authorize URL", () => {
  it("is unaffected — it never relied on a silent prompt", async () => {
    const url = await authorizeUrl("google");
    expect(url).not.toContain("prompt=none");
  });
});
