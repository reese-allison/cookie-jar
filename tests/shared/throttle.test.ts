import { describe, expect, it } from "vitest";
import { createThrottle } from "../../src/shared/throttle";

describe("createThrottle", () => {
  it("allows the first call", () => {
    const t = createThrottle(100, () => 0);
    expect(t()).toBe(true);
  });

  it("drops calls inside the interval", () => {
    let now = 0;
    const t = createThrottle(100, () => now);
    expect(t()).toBe(true);
    now = 50;
    expect(t()).toBe(false);
    now = 99;
    expect(t()).toBe(false);
  });

  it("allows a call once the interval elapses", () => {
    let now = 0;
    const t = createThrottle(100, () => now);
    t(); // t=0
    now = 100;
    expect(t()).toBe(true);
  });

  it("gates per-instance (two throttles are independent)", () => {
    const now = 0;
    const a = createThrottle(100, () => now);
    const b = createThrottle(100, () => now);
    expect(a()).toBe(true);
    expect(a()).toBe(false);
    expect(b()).toBe(true);
  });
});
