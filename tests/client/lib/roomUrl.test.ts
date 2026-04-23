import { describe, expect, it } from "vitest";
import { parseCodeFromPath, pathForRoom } from "../../../src/client/lib/roomUrl";

describe("parseCodeFromPath", () => {
  it("extracts a valid 6-char room code", () => {
    expect(parseCodeFromPath("/ABCDEF")).toBe("ABCDEF");
  });

  it("upper-cases lowercase codes so /abcdef still resolves", () => {
    expect(parseCodeFromPath("/abcdef")).toBe("ABCDEF");
  });

  it("returns null for the root path", () => {
    expect(parseCodeFromPath("/")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseCodeFromPath("")).toBeNull();
  });

  it("returns null for nested paths", () => {
    // Only a single path segment is valid — an app-wide SPA fallback must
    // never mistakenly auto-join on an unrelated deep link.
    expect(parseCodeFromPath("/room/ABCDEF")).toBeNull();
  });

  it("ignores a trailing slash", () => {
    expect(parseCodeFromPath("/ABCDEF/")).toBe("ABCDEF");
  });

  it("returns null for strings the room-code validator rejects", () => {
    expect(parseCodeFromPath("/ABC")).toBeNull(); // too short
    expect(parseCodeFromPath("/TOOLONGCODE")).toBeNull(); // too long
    expect(parseCodeFromPath("/ABCDE!")).toBeNull(); // invalid char
  });
});

describe("pathForRoom", () => {
  it("builds /CODE from a room code", () => {
    expect(pathForRoom("ABCDEF")).toBe("/ABCDEF");
  });

  it("returns / when there is no room code", () => {
    expect(pathForRoom(null)).toBe("/");
  });
});
