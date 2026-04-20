import { expect, test } from "./fixtures";

test("happy path: sign in, create jar, add note, pull it", async ({ anonOwner }) => {
  const { page } = anonOwner;

  // Regression guard: splitting useSocket across Landing/InRoom trees caused the
  // socket to be torn down the moment room:state arrived. The banner appeared
  // permanently and all note events silently dropped.
  await expect(page.getByRole("alert").filter({ hasText: /Connection lost/i })).toHaveCount(0);

  // Add a note
  await page.locator(".note-form__text").fill("First note");
  await page.getByRole("button", { name: /Add to Jar/i }).click();

  // Jar count should become 1
  await expect(page.locator(".jar__count")).toHaveText("1");

  // Pull it
  await page.getByRole("button", { name: /Pull from jar/i }).click();

  // Pulled note is rendered
  await expect(page.getByText("First note")).toBeVisible();
  await expect(page.locator(".jar__count")).toHaveText("0");
});
