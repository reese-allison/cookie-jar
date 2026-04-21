/**
 * Visual regression tests.
 *
 * These snapshots exist so we can refactor CSS (design tokens, button
 * primitives, spacing cleanup) without shipping visual regressions. They are
 * *narrow* — each test exercises one self-contained piece of UI in a stable
 * state. We freeze motion, wait for fonts, and mask non-deterministic text
 * (room codes) so snapshots are reproducible.
 *
 * Baselines live under `tests/e2e/visual.spec.ts-snapshots/` and are committed.
 * To regenerate intentionally:  `bun run e2e --update-snapshots visual.spec.ts`
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Room code and jar name are non-deterministic (per-run suffix). Masking them
 * produces different mask sizes across runs because the underlying text width
 * varies — which in turn shifts neighbouring elements by a pixel or two.
 *
 * We instead *rewrite* those text nodes in place with stable values before
 * the screenshot. That keeps their rendered box sizes identical run-to-run
 * without masking anything else on the page.
 */
async function pinNonDeterministicText(page: Page): Promise<void> {
  await page.evaluate(() => {
    const set = (sel: string, value: string) => {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        el.textContent = value;
      }
    };
    set(".room-code", "ROOMCD");
    set(".room-jar-name", "Test Jar");
    for (const btn of document.querySelectorAll<HTMLElement>("[aria-label^='Copy room code']")) {
      btn.setAttribute("aria-label", "Copy room code ROOMCD");
    }
    // Jar-name input inside the settings drawer mirrors the fixture name.
    for (const inp of document.querySelectorAll<HTMLInputElement>(
      ".jar-settings-field input[type='text']",
    )) {
      if (inp.value.startsWith("Test Jar ")) inp.value = "Test Jar";
    }
  });
}

async function stabilize(page: Page): Promise<void> {
  // Freeze every animation / transition so sub-frame timing differences can't
  // shift pixels. prefers-reduced-motion also kicks in via the CSS reset.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  // Wait for web fonts (Caveat, Nunito, JetBrains Mono) so text metrics are
  // deterministic before pixel-diff.
  await page.evaluate(() => document.fonts.ready);
}

test.describe("visual regression", () => {
  test("landing — join tab (authed)", async ({ anonOwner }) => {
    const { page } = anonOwner;
    await page.goto("/");
    await page.getByRole("button", { name: /Sign out/i }).waitFor({ state: "visible" });
    await stabilize(page);
    await pinNonDeterministicText(page);
    await expect(page).toHaveScreenshot("landing-join.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("landing — host tab (authed)", async ({ anonOwner }) => {
    const { page } = anonOwner;
    await page.goto("/");
    await page.getByRole("radio", { name: /Host/i }).click();
    await page.getByPlaceholder("Jar name").waitFor({ state: "visible" });
    await stabilize(page);
    await pinNonDeterministicText(page);
    await expect(page).toHaveScreenshot("landing-host.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("in-room — empty jar", async ({ anonOwner }) => {
    const { page } = anonOwner;
    await stabilize(page);
    await pinNonDeterministicText(page);
    await expect(page).toHaveScreenshot("room-empty.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("in-room — one note pulled", async ({ anonOwner }) => {
    const { page } = anonOwner;
    await page.locator(".note-form__text").fill("Visual test note");
    await page.getByRole("button", { name: /Add to Jar/i }).click();
    await expect(page.locator(".jar__count")).toHaveText("1");
    await page.getByRole("button", { name: /Pull from jar/i }).click();
    await page.getByText("Visual test note").waitFor({ state: "visible" });
    await stabilize(page);
    await pinNonDeterministicText(page);
    await expect(page).toHaveScreenshot("room-pulled-note.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("jar settings drawer — open", async ({ anonOwner }) => {
    const { page } = anonOwner;
    await page.getByRole("button", { name: /Jar settings/i }).click();
    await page.getByRole("dialog", { name: /Jar settings/i }).waitFor({ state: "visible" });
    await stabilize(page);
    await pinNonDeterministicText(page);
    await expect(page).toHaveScreenshot("jar-settings-open.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("locked state", async ({ anonOwner }) => {
    const { page } = anonOwner;
    await page.getByRole("button", { name: /^Lock$/ }).click();
    // The badge text is "Locked" (CSS uppercases via text-transform). Target
    // the class rather than regexing the visible casing.
    await page.locator(".room-state").waitFor({ state: "visible" });
    await stabilize(page);
    await pinNonDeterministicText(page);
    await expect(page).toHaveScreenshot("room-locked.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});
