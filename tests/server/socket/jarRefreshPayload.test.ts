import { describe, expect, it } from "vitest";
import { buildJarRefreshPayload } from "../../../src/server/socket/roomHandler";
import { makeJarConfig } from "../../helpers/fixtures";

const JAR_CONFIG = makeJarConfig();

describe("buildJarRefreshPayload", () => {
  it("never includes pulledNotes — keeps the broadcast tiny", () => {
    const payload = buildJarRefreshPayload(
      { name: "Jar", config: JAR_CONFIG, appearance: { label: "Jar" } },
      42,
    );
    expect(payload).not.toHaveProperty("pulledNotes");
  });

  it("forwards inJarCount, jarName, config, and appearance", () => {
    const payload = buildJarRefreshPayload(
      { name: "Jar", config: JAR_CONFIG, appearance: { label: "Jar" } },
      42,
    );
    expect(payload.inJarCount).toBe(42);
    expect(payload.jarName).toBe("Jar");
    expect(payload.jarConfig).toBe(JAR_CONFIG);
    expect(payload.jarAppearance).toEqual({ label: "Jar" });
  });

  it("stays small when serialized (config+appearance only)", () => {
    const payload = buildJarRefreshPayload(
      { name: "Jar", config: JAR_CONFIG, appearance: { label: "Jar" } },
      100,
    );
    // Sanity check: even with realistic data we stay well under 1 KB.
    expect(JSON.stringify(payload).length).toBeLessThan(1024);
  });

  it("handles null config/appearance without crashing", () => {
    const payload = buildJarRefreshPayload({ config: null, appearance: null }, 0);
    expect(payload.jarConfig).toBeUndefined();
    expect(payload.jarAppearance).toBeUndefined();
    expect(payload.jarName).toBeUndefined();
  });
});
