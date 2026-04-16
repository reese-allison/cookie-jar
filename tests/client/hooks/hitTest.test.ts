import { describe, expect, it } from "vitest";
import { hitTestRect } from "../../../src/client/hooks/hitTest";

describe("hitTestRect", () => {
  it("returns true when point is inside rect", () => {
    const rect = { left: 100, top: 100, right: 200, bottom: 200 };
    expect(hitTestRect(150, 150, rect)).toBe(true);
  });

  it("returns false when point is outside rect", () => {
    const rect = { left: 100, top: 100, right: 200, bottom: 200 };
    expect(hitTestRect(50, 50, rect)).toBe(false);
  });

  it("returns true when point is on the edge", () => {
    const rect = { left: 100, top: 100, right: 200, bottom: 200 };
    expect(hitTestRect(100, 100, rect)).toBe(true);
  });

  it("returns false when point is just outside right edge", () => {
    const rect = { left: 100, top: 100, right: 200, bottom: 200 };
    expect(hitTestRect(201, 150, rect)).toBe(false);
  });
});
