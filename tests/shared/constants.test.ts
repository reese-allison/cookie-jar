import { describe, expect, it } from "vitest";
import {
  MAX_BULK_IMPORT,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_NOTE_TEXT_LENGTH,
  MAX_NOTES_PER_JAR,
} from "../../src/shared/constants";

// Abuse-adjacent caps: enforced on both REST and socket paths. If these go
// missing a single jar can balloon memory/DB usage. Changing the numbers is
// fine — deleting them is not.
describe("abuse-limit constants", () => {
  it("caps notes per jar at a finite sane value", () => {
    expect(MAX_NOTES_PER_JAR).toBeGreaterThan(100);
    expect(MAX_NOTES_PER_JAR).toBeLessThanOrEqual(10_000);
  });

  it("caps bulk import at or below the per-jar cap", () => {
    expect(MAX_BULK_IMPORT).toBeGreaterThan(10);
    expect(MAX_BULK_IMPORT).toBeLessThanOrEqual(MAX_NOTES_PER_JAR);
  });

  it("caps note text at 500 chars (matches DB CHECK constraint)", () => {
    expect(MAX_NOTE_TEXT_LENGTH).toBe(500);
  });

  it("caps display name at 30 chars", () => {
    expect(MAX_DISPLAY_NAME_LENGTH).toBe(30);
  });
});
