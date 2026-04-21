import { type Browser, type BrowserContext, test as base, type Page } from "@playwright/test";

/**
 * Signs in anonymously and waits for the session to land. Requires DEV build of
 * the client (the Continue anonymously button is stripped from prod bundles).
 */
async function signInAnonymously(page: Page): Promise<void> {
  await page.goto("/");
  // Auth buttons live under the Host tab (Join tab only shows the room-code
  // form). Unauthed users default to Join, so switch over first.
  await page.getByRole("radio", { name: /Host/i }).click();
  // Safety: fail fast if we accidentally run against a prod build with no dev button.
  const devBtn = page.getByRole("button", { name: /Continue anonymously/i });
  await devBtn.waitFor({ state: "visible", timeout: 10_000 });
  await devBtn.click();
  // After sign-in the RoomCodeEntry re-renders showing UserMenu + CreateJar form.
  await page.getByRole("button", { name: /Sign out/i }).waitFor({ state: "visible" });
}

/**
 * Creates a jar and auto-joins its room. Returns the room code.
 */
async function createJarAndJoin(page: Page, name: string): Promise<string> {
  // CreateJar form has an input with maxLength=100 and placeholder "Jar name"
  await page.getByPlaceholder("Jar name").fill(name);
  await page.getByRole("button", { name: /Create Jar/i }).click();
  // After createJarAndJoin the room loads — room code appears in the room header
  const codeEl = page.locator(".room-code");
  await codeEl.waitFor({ state: "visible", timeout: 15_000 });
  const code = (await codeEl.textContent())?.trim();
  if (!code) throw new Error("room code never appeared");
  return code;
}

/**
 * Creates a second browser context (separate cookies/storage) and signs in anonymously
 * as a different user. Returns a Page already on the landing screen.
 */
async function newPeerContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAnonymously(page);
  return { context, page };
}

/**
 * Peer joins an existing room by code.
 */
async function joinRoom(page: Page, code: string): Promise<void> {
  await page.getByPlaceholder("Room Code").fill(code);
  await page.getByRole("button", { name: /Join Room/i }).click();
  await page.locator(".room-code").waitFor({ state: "visible", timeout: 10_000 });
}

export interface OwnerFixture {
  page: Page;
  roomCode: string;
}

export interface TwoUsersFixture {
  owner: OwnerFixture;
  peer: { page: Page; context: BrowserContext };
}

export const test = base.extend<{
  anonOwner: OwnerFixture;
  twoUsers: TwoUsersFixture;
}>({
  anonOwner: async ({ page }, use) => {
    await signInAnonymously(page);
    const jarName = `Test Jar ${Date.now().toString(36)}`;
    const roomCode = await createJarAndJoin(page, jarName);
    await use({ page, roomCode });
  },

  twoUsers: async ({ browser, page }, use) => {
    // Owner in the default context
    await signInAnonymously(page);
    const jarName = `Test Jar ${Date.now().toString(36)}`;
    const roomCode = await createJarAndJoin(page, jarName);

    // Peer in a fresh context (own cookies / own anon user)
    const peer = await newPeerContext(browser);
    await joinRoom(peer.page, roomCode);

    await use({
      owner: { page, roomCode },
      peer: { page: peer.page, context: peer.context },
    });

    await peer.context.close();
  },
});

export { expect } from "@playwright/test";
export { createJarAndJoin, joinRoom, newPeerContext, signInAnonymously };
