import { expect, test } from "./fixtures";

test.describe("multi-user", () => {
  test("peer sees a note the owner pulled in shared mode", async ({ twoUsers }) => {
    const { owner, peer } = twoUsers;

    // Owner adds a note
    await owner.page.locator(".note-form__text").fill("Shared pull");
    await owner.page.getByRole("button", { name: /Add to Jar/i }).click();
    await expect(owner.page.locator(".jar__count")).toHaveText("1");

    // Peer sees the incremented count too
    await expect(peer.page.locator(".jar__count")).toHaveText("1");

    // Owner pulls. In shared mode the peer should see the pulled note render.
    await owner.page.getByRole("button", { name: /Pull from jar/i }).click();
    await expect(owner.page.getByText("Shared pull")).toBeVisible();
    await expect(peer.page.getByText("Shared pull")).toBeVisible();
  });

  test("owner switching to Sealed changes visibility for peer", async ({ twoUsers }) => {
    const { owner, peer } = twoUsers;

    // Open drawer and switch to Sealed with revealAt=2
    await owner.page.getByRole("button", { name: /Jar settings/i }).click();
    const drawer = owner.page.getByRole("dialog", { name: /Jar settings/i });
    await drawer.getByRole("radio", { name: /Sealed/i }).click();

    // Add 2 notes via bulk so we can pull twice without typing
    await drawer.locator("#bulk-import-textarea").fill("A\nB");
    await drawer.getByRole("button", { name: /Import 2/i }).click();
    await owner.page.keyboard.press("Escape");

    // With reveal=1 (default), first pull reveals. With reveal=2 it shouldn't.
    // Move the slider to 2.
    await owner.page.getByRole("button", { name: /Jar settings/i }).click();
    const drawerAgain = owner.page.getByRole("dialog", { name: /Jar settings/i });
    const slider = drawerAgain.getByLabel(/Reveal at/i);
    await slider.fill("2");
    await owner.page.keyboard.press("Escape");

    // Owner pulls once — note should NOT appear yet because sealed + reveal=2
    await owner.page.getByRole("button", { name: /Pull from jar/i }).click();

    // The pulled text should not be visible on either side during sealed hold
    await expect(owner.page.getByText(/^[AB]$/, { exact: true })).toHaveCount(0);
    await expect(peer.page.getByText(/^[AB]$/, { exact: true })).toHaveCount(0);

    // Second pull triggers the reveal
    await owner.page.getByRole("button", { name: /Pull from jar/i }).click();
    await expect(owner.page.locator(".pulled-note")).toHaveCount(2);
    await expect(peer.page.locator(".pulled-note")).toHaveCount(2);
  });

  test("locked room blocks add/discard but still allows pull", async ({ twoUsers }) => {
    const { owner, peer } = twoUsers;

    // Owner seeds a note so there's something to pull later.
    await owner.page.locator(".note-form__text").fill("Locked pull");
    await owner.page.getByRole("button", { name: /Add to Jar/i }).click();
    await expect(owner.page.locator(".jar__count")).toHaveText("1");
    await expect(peer.page.locator(".jar__count")).toHaveText("1");

    // Peer starts as contributor — NoteForm + DiscardBin visible.
    await expect(peer.page.locator(".note-form__text")).toBeVisible();
    await expect(peer.page.locator(".discard-bin")).toBeVisible();

    // Owner locks the room.
    await owner.page.getByRole("button", { name: /^Lock$/ }).click();

    // Peer's NoteForm and DiscardBin should hide.
    await expect(peer.page.locator(".note-form__text")).toBeHidden();
    await expect(peer.page.locator(".discard-bin")).toBeHidden();

    // Jar button is still enabled — peer can still pull.
    const jarButton = peer.page.locator(".jar__body");
    await expect(jarButton).toBeEnabled();
    await jarButton.click();
    await expect(peer.page.locator(".pulled-note")).toContainText("Locked pull");

    // The pulled note shows Return but NOT Discard while locked.
    const pulledNote = peer.page.locator(".pulled-note").filter({ hasText: "Locked pull" });
    await expect(pulledNote.getByRole("button", { name: /Return/i })).toBeVisible();
    await expect(pulledNote.getByRole("button", { name: /Discard/i })).toHaveCount(0);
  });
});
