import { expect, test } from "./fixtures";

const STYLES: Array<{ key: string; label: string }> = [
  { key: "sticky", label: "Sticky" },
  { key: "index_card", label: "Index card" },
  { key: "napkin", label: "Napkin" },
  { key: "parchment", label: "Parchment" },
  { key: "fortune_cookie", label: "Fortune" },
];

test.describe("note styles", () => {
  test("each style selection produces a distinct rendered class on the pulled note", async ({
    anonOwner,
  }) => {
    const { page } = anonOwner;

    for (const { key: style, label } of STYLES) {
      // Pick the style in the picker
      const tile = page.getByRole("radio", { name: label, exact: true });
      await tile.click();
      await expect(tile).toHaveAttribute("aria-checked", "true");

      // Add the note
      await page.locator(".note-form__text").fill(`Note for ${style}`);
      await page.getByRole("button", { name: /Add to Jar/i }).click();
      // Wait for it to land in the jar
      await expect(page.locator(".jar__count")).not.toHaveText("0");

      // Pull it
      await page.getByRole("button", { name: /Pull from jar/i }).click();

      // The rendered pulled note must carry a class modifier matching the style.
      // This is the user-reported bug: styles don't "do anything" on the pulled note.
      const rendered = page.locator(".pulled-note").filter({ hasText: `Note for ${style}` });
      await expect(rendered).toBeVisible();
      await expect(rendered).toHaveClass(new RegExp(`pulled-note--${style}`));

      // Discard so the next iteration starts with an empty jar
      const discardBtn = rendered.getByRole("button", { name: /Discard/i });
      await discardBtn.click();
      await expect(rendered).toBeHidden();
    }
  });

  test("NoteForm reflects the currently selected style", async ({ anonOwner }) => {
    const { page } = anonOwner;
    const form = page.locator("form.note-form");

    for (const label of ["Sticky", "Napkin", "Parchment", "Fortune"]) {
      await page.getByRole("radio", { name: label, exact: true }).click();
      const key = label === "Fortune" ? "fortune_cookie" : label.toLowerCase();
      await expect(form).toHaveClass(new RegExp(`note-form--${key}`));
    }
  });
});
