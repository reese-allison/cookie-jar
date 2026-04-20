import { promises as fs } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger";
import type { Storage } from "./Storage";

export function createLocalDiskStorage(dir: string, urlPrefix = "/uploads"): Storage {
  // Eagerly ensure the directory exists. mkdir can race with a concurrent
  // createLocalDiskStorage call, so we log on rejection rather than swallow
  // silently — a surprising ENOENT on first upload is worse than a noisy boot
  // log that tells you the upload dir isn't writable.
  fs.mkdir(dir, { recursive: true }).catch((err: unknown) => {
    logger.error({ err, dir }, "local upload dir mkdir failed");
  });

  return {
    async put(key, body) {
      await fs.writeFile(join(dir, key), body);
      return `${urlPrefix}/${key}`;
    },
  };
}
