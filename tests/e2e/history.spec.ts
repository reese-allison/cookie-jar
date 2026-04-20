import { expect, test } from "./fixtures";

test.describe("pull history", () => {
  test("non-owner does not see the Clear button", async ({ twoUsers }) => {
    const { owner, peer } = twoUsers;

    // Owner seeds a note and pulls it so the history has an entry.
    await owner.page.locator(".note-form__text").fill("Seed");
    await owner.page.getByRole("button", { name: /Add to Jar/i }).click();
    await owner.page.getByRole("button", { name: /Pull from jar/i }).click();
    await expect(owner.page.locator(".pulled-note")).toBeVisible();

    // Peer opens history — they see entries but MUST NOT see Clear.
    await peer.page.getByRole("button", { name: /^History/i }).click();
    await expect(peer.page.locator(".pull-history__entry")).toHaveCount(1);
    await expect(peer.page.getByRole("button", { name: /Clear history/i })).toHaveCount(0);
  });

  test("clear button actually clears the history", async ({ anonOwner }) => {
    const { page } = anonOwner;

    // Seed 3 notes and pull each
    for (let i = 1; i <= 3; i++) {
      await page.locator(".note-form__text").fill(`Historic note ${i}`);
      await page.getByRole("button", { name: /Add to Jar/i }).click();
      await expect(page.locator(".jar__count")).toHaveText(String(i));
    }
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: /Pull from jar/i }).click();
      await expect(page.locator(".jar__count")).toHaveText(String(2 - i));
    }

    // Open History panel
    const toggle = page.getByRole("button", { name: /^History/i });
    await toggle.click();

    // 3 entries expected
    const entries = page.locator(".pull-history__entry");
    await expect(entries).toHaveCount(3);

    // Click Clear
    await page.getByRole("button", { name: /Clear history/i }).click();

    // The entries should be gone, "No pulls yet" should show.
    await expect(entries).toHaveCount(0);
    await expect(page.getByText(/No pulls yet/i)).toBeVisible();
  });
});
