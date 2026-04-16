import { describe, expect, it } from "vitest";
import { ROOM_CODE_CHARS, ROOM_CODE_LENGTH } from "../../src/shared/constants";
import {
  generateRoomCode,
  isValidNoteText,
  isValidRoomCode,
  isValidUrl,
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
