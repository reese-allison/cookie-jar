import { expect, test } from "./fixtures";

test.describe("sealed mode", () => {
  test("folded-note placeholders render while under the reveal threshold", async ({
    anonOwner,
  }) => {
    const { page } = anonOwner;

    // Bulk-seed 3 notes + switch to Sealed with revealAt=3
    await page.getByRole("button", { name: /Jar settings/i }).click();
    const drawer = page.getByRole("dialog", { name: /Jar settings/i });
    await drawer.locator("#bulk-import-textarea").fill("one\ntwo\nthree");
    await drawer.getByRole("button", { name: /Import 3/i }).click();
    await drawer.getByRole("radio", { name: /Sealed/i }).click();
    await drawer.getByLabel(/Reveal at/i).fill("3");
    await page.keyboard.press("Escape");

    // Pull twice — below threshold, notes should be represented as folded cards.
    await page.getByRole("button", { name: /Pull from jar/i }).click();
    await expect(page.locator(".sealed-card")).toHaveCount(1);
    await expect(page.getByText(/1.*of.*3.*drawn/i)).toBeVisible();

    await page.getByRole("button", { name: /Pull from jar/i }).click();
    await expect(page.locator(".sealed-card")).toHaveCount(2);
    await expect(page.getByText(/2.*of.*3.*drawn/i)).toBeVisible();

    // Third pull hits the threshold — placeholders disappear, real notes show.
    await page.getByRole("button", { name: /Pull from jar/i }).click();
    await expect(page.locator(".sealed-card")).toHaveCount(0);
    await expect(page.locator(".pulled-note")).toHaveCount(3);
  });
});
