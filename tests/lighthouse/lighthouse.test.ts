/// <reference types="node" />
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const IMAGE_TAG = "cookie-jar-lighthouse:test";
const DOCKERFILE = "Dockerfile.lighthouse";

const MIN_SCORE = Number(process.env.LIGHTHOUSE_MIN_SCORE ?? "0.9");
const INCLUDE_PWA = process.env.LIGHTHOUSE_INCLUDE_PWA === "1";

type CategoryKey = "performance" | "accessibility" | "best-practices" | "seo" | "pwa";
type RunnerResult = { url: string; scores: Partial<Record<CategoryKey, number>> };

const REQUIRED_CATEGORIES: CategoryKey[] = INCLUDE_PWA
  ? ["performance", "accessibility", "best-practices", "seo", "pwa"]
  : ["performance", "accessibility", "best-practices", "seo"];

// Lighthouse needs a real Chromium and adds ~2 min per run, so this suite is
// gated behind RUN_LIGHTHOUSE=1 and excluded from the default `bun run test:run`.
// CI invokes it via `bun run test:lighthouse`.
describe.skipIf(!process.env.RUN_LIGHTHOUSE)("Lighthouse audit (sandboxed)", () => {
  beforeAll(
    () => {
      execFileSync("docker", ["build", "-f", DOCKERFILE, "-t", IMAGE_TAG, "."], {
        cwd: REPO_ROOT,
        stdio: "inherit",
      });
    },
    10 * 60 * 1000,
  );

  it(
    "scores every category at or above the green threshold",
    () => {
      const stdout = execFileSync("docker", ["run", "--rm", IMAGE_TAG], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          ...(INCLUDE_PWA ? { LIGHTHOUSE_INCLUDE_PWA: "1" } : {}),
        },
      });

      const results = parseRunnerOutput(stdout);
      expect(results.length).toBeGreaterThan(0);

      const failures: string[] = [];
      for (const { url, scores } of results) {
        for (const category of REQUIRED_CATEGORIES) {
          const score = scores[category];
          if (typeof score !== "number") {
            failures.push(`${url}: missing "${category}" score`);
            continue;
          }
          if (score < MIN_SCORE) {
            failures.push(`${url}: ${category}=${score.toFixed(2)} < ${MIN_SCORE}`);
          }
        }
      }

      expect(failures, failures.join("\n")).toEqual([]);
    },
    5 * 60 * 1000,
  );
});

// The runner emits a single JSON line; build/install logs come on stderr.
// Find the JSON payload by scanning for a line that parses as the expected shape.
function parseRunnerOutput(stdout: string): RunnerResult[] {
  for (const line of stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()) {
    if (!line.startsWith("[") && !line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        Array.isArray(parsed) &&
        parsed.every((r) => r && typeof r.url === "string" && r.scores)
      ) {
        return parsed as RunnerResult[];
      }
    } catch {
      // not JSON — keep scanning
    }
  }
  throw new Error(`Could not find Lighthouse runner JSON in container stdout:\n${stdout}`);
}
