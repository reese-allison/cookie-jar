import { describe, expect, it } from "vitest";
import { ROOM_CODE_CHARS, ROOM_CODE_LENGTH } from "../../src/shared/constants";
import {
  generateRoomCode,
  isValidNoteText,
  isValidRoomCode,
  isValidUrl,
  sanitizeJarAppearance,
  sanitizeJarConfig,
} from "../../src/shared/validation";

describe("isValidRoomCode", () => {
  it("accepts a valid 6-char room code", () => {
    expect(isValidRoomCode("AB2CDE")).toBe(true);
  });

  it("rejects codes that are too short", () => {
    expect(isValidRoomCode("AB2C")).toBe(false);
  });

  it("rejects codes that are too long", () => {
    expect(isValidRoomCode("AB2CDEF")).toBe(false);
  });

  it("rejects codes with ambiguous characters (I, O, 1, 0)", () => {
    expect(isValidRoomCode("AIBCDE")).toBe(false);
    expect(isValidRoomCode("A0BCDE")).toBe(false);
    expect(isValidRoomCode("A1BCDE")).toBe(false);
    expect(isValidRoomCode("AOBCDE")).toBe(false);
  });

  it("rejects lowercase characters", () => {
    expect(isValidRoomCode("abcdef")).toBe(false);
  });
});

describe("isValidNoteText", () => {
  it("accepts normal text", () => {
    expect(isValidNoteText("Pick a restaurant!")).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(isValidNoteText("")).toBe(false);
  });

  it("rejects whitespace-only strings", () => {
    expect(isValidNoteText("   ")).toBe(false);
  });

  it("rejects text over 500 characters", () => {
    expect(isValidNoteText("a".repeat(501))).toBe(false);
  });

  it("accepts text at exactly 500 characters", () => {
    expect(isValidNoteText("a".repeat(500))).toBe(true);
  });
});

describe("isValidUrl", () => {
  it("accepts https URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
  });

  it("accepts http URLs", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
  });

  it("rejects non-http protocols", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(isValidUrl("not a url")).toBe(false);
  });
});

describe("generateRoomCode", () => {
  it("generates a code of the correct length", () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
  });

  it("generates codes using only valid characters", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      for (const char of code) {
        expect(ROOM_CODE_CHARS).toContain(char);
      }
    }
  });

  it("generates different codes on successive calls", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("sanitizeJarAppearance", () => {
  it("returns {} for null/undefined/empty", () => {
    expect(sanitizeJarAppearance(undefined)).toEqual({});
    expect(sanitizeJarAppearance(null)).toEqual({});
    expect(sanitizeJarAppearance({})).toEqual({});
  });

  it("keeps valid http(s) URLs", () => {
    const out = sanitizeJarAppearance({
      openedImageUrl: "https://cdn.example.com/open.png",
      closedImageUrl: "http://cdn.example.com/closed.png",
    });
    expect(out).toEqual({
      openedImageUrl: "https://cdn.example.com/open.png",
      closedImageUrl: "http://cdn.example.com/closed.png",
    });
  });

  it("rejects javascript: URLs in image fields", () => {
    expect(sanitizeJarAppearance({ openedImageUrl: "javascript:alert(1)" })).toBeNull();
  });

  it("rejects javascript: URLs in soundPack", () => {
    expect(sanitizeJarAppearance({ soundPack: { notePull: "javascript:alert(1)" } })).toBeNull();
  });

  it("drops unknown fields silently", () => {
    expect(sanitizeJarAppearance({ evilField: "bad" })).toEqual({});
  });

  it("rejects non-object input", () => {
    expect(sanitizeJarAppearance("oops")).toBeNull();
    expect(sanitizeJarAppearance(42)).toBeNull();
  });

  it("rejects oversized label", () => {
    expect(sanitizeJarAppearance({ label: "x".repeat(101) })).toBeNull();
  });
});

describe("sanitizeJarConfig", () => {
  it("returns {} for null/undefined/empty", () => {
    expect(sanitizeJarConfig(undefined)).toEqual({});
    expect(sanitizeJarConfig(null)).toEqual({});
    expect(sanitizeJarConfig({})).toEqual({});
  });

  it("accepts a complete valid config", () => {
    const out = sanitizeJarConfig({
      noteVisibility: "sealed",
      pullVisibility: "private",
      sealedRevealCount: 5,
      showAuthors: true,
      showPulledBy: false,
    });
    expect(out).toEqual({
      noteVisibility: "sealed",
      pullVisibility: "private",
      sealedRevealCount: 5,
      showAuthors: true,
      showPulledBy: false,
    });
  });

  it("rejects unknown enum values", () => {
    expect(sanitizeJarConfig({ noteVisibility: "exploded" })).toBeNull();
    expect(sanitizeJarConfig({ pullVisibility: "global" })).toBeNull();
  });

  it("rejects absurd sealedRevealCount", () => {
    expect(sanitizeJarConfig({ sealedRevealCount: 0 })).toBeNull();
    expect(sanitizeJarConfig({ sealedRevealCount: 10_000 })).toBeNull();
    expect(sanitizeJarConfig({ sealedRevealCount: 1.5 })).toBeNull();
  });

  it("rejects non-boolean flags", () => {
    expect(sanitizeJarConfig({ showAuthors: "yes" })).toBeNull();
  });
});
