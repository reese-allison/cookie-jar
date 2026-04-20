import { describe, expect, it } from "vitest";
import { buildJarRefreshPayload } from "../../../src/server/socket/roomHandler";

const JAR_CONFIG = {
  noteVisibility: "open" as const,
  pullVisibility: "shared" as const,
  sealedRevealCount: 1,
  showAuthors: false,
  showPulledBy: false,
};

describe("buildJarRefreshPayload", () => {
  it("never includes pulledNotes — keeps the broadcast tiny", () => {
    const payload = buildJarRefreshPayload(
      { config: JAR_CONFIG, appearance: { label: "Jar" } },
      42,
      { alice: 5 },
    );
    expect(payload).not.toHaveProperty("pulledNotes");
  });

  it("forwards inJarCount, pullCounts, config, and appearance", () => {
    const payload = buildJarRefreshPayload(
      { config: JAR_CONFIG, appearance: { label: "Jar" } },
      42,
      { alice: 5 },
    );
    expect(payload.inJarCount).toBe(42);
    expect(payload.pullCounts).toEqual({ alice: 5 });
    expect(payload.jarConfig).toBe(JAR_CONFIG);
    expect(payload.jarAppearance).toEqual({ label: "Jar" });
  });

  it("stays small when serialized (config+appearance only)", () => {
    const payload = buildJarRefreshPayload(
      { config: JAR_CONFIG, appearance: { label: "Jar" } },
      100,
      {},
    );
    // Sanity check: even with realistic data we stay well under 1 KB.
    expect(JSON.stringify(payload).length).toBeLessThan(1024);
  });

  it("handles null config/appearance without crashing", () => {
    const payload = buildJarRefreshPayload({ config: null, appearance: null }, 0, {});
    expect(payload.jarConfig).toBeUndefined();
    expect(payload.jarAppearance).toBeUndefined();
  });
});
