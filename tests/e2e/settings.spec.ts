import { expect, test } from "./fixtures";

test.describe("jar settings drawer", () => {
  test("gear button opens the drawer; Esc closes it", async ({ anonOwner }) => {
    const { page } = anonOwner;
    await page.getByRole("button", { name: /Jar settings/i }).click();
    const drawer = page.getByRole("dialog", { name: /Jar settings/i });
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("selecting Sealed reveals the reveal-count slider", async ({ anonOwner }) => {
    const { page } = anonOwner;
    await page.getByRole("button", { name: /Jar settings/i }).click();
    const drawer = page.getByRole("dialog", { name: /Jar settings/i });

    // Slider should not be visible before Sealed is picked
    await expect(drawer.getByLabel(/Reveal at/i)).toBeHidden();

    await drawer.getByRole("radio", { name: /Sealed/i }).click();

    await expect(drawer.getByLabel(/Reveal at/i)).toBeVisible();
  });

  test("bulk import increments the jar count", async ({ anonOwner }) => {
    const { page } = anonOwner;
    await page.getByRole("button", { name: /Jar settings/i }).click();
    const drawer = page.getByRole("dialog", { name: /Jar settings/i });

    const texts = Array.from({ length: 5 }, (_, i) => `Bulk ${i + 1}`).join("\n");
    await drawer.locator("#bulk-import-textarea").fill(texts);
    await expect(drawer.getByText(/5 notes ready/i)).toBeVisible();

    await drawer.getByRole("button", { name: /Import 5/i }).click();
    await expect(drawer.getByText(/Added 5 notes/i)).toBeVisible();

    // Close the drawer and verify jar count
    await page.keyboard.press("Escape");
    await expect(page.locator(".jar__count")).toHaveText("5");
  });
});
