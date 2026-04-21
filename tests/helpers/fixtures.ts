import type { JarAppearance, JarConfig } from "../../src/shared/types";

/**
 * Default JarConfig for tests. Override only the fields a test cares about so
 * new required fields don't have to be added 20 places when the type grows:
 *
 *   const config = makeJarConfig({ pullVisibility: "private" });
 */
export const DEFAULT_JAR_CONFIG: JarConfig = {
  noteVisibility: "open",
  pullVisibility: "shared",
  sealedRevealCount: 1,
  showAuthors: false,
  showPulledBy: false,
  onLeaveBehavior: "return",
};

export function makeJarConfig(overrides: Partial<JarConfig> = {}): JarConfig {
  return { ...DEFAULT_JAR_CONFIG, ...overrides };
}

export const DEFAULT_JAR_APPEARANCE: JarAppearance = {
  label: "Test Jar",
};

export function makeJarAppearance(overrides: Partial<JarAppearance> = {}): JarAppearance {
  return { ...DEFAULT_JAR_APPEARANCE, ...overrides };
}
