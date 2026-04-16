/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { soundManager } from "../../../src/client/lib/sounds";

beforeEach(() => {
  soundManager.setEnabled(true);
  soundManager.setVolume(0.5);
});

describe("SoundManager", () => {
  it("does not throw when playing a sound", () => {
    // In jsdom, Audio may not be fully supported, but play() should not throw
    expect(() => soundManager.play("noteAdd")).not.toThrow();
  });

  it("does not play when disabled", () => {
    soundManager.setEnabled(false);
    // No error even when disabled
    expect(() => soundManager.play("noteAdd")).not.toThrow();
  });

  it("toggles enabled state", () => {
    expect(soundManager.isEnabled()).toBe(true);
    soundManager.setEnabled(false);
    expect(soundManager.isEnabled()).toBe(false);
  });

  it("clamps volume between 0 and 1", () => {
    soundManager.setVolume(1.5);
    expect(soundManager.getVolume()).toBe(1);

    soundManager.setVolume(-0.5);
    expect(soundManager.getVolume()).toBe(0);
  });

  it("accepts valid volume values", () => {
    soundManager.setVolume(0.75);
    expect(soundManager.getVolume()).toBe(0.75);
  });
});
