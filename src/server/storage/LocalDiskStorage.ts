import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Storage } from "./Storage";

export function createLocalDiskStorage(dir: string, urlPrefix = "/uploads"): Storage {
  // Eagerly ensure the directory exists. Done at construction time so we fail
  // fast during boot rather than on the first upload.
  void fs.mkdir(dir, { recursive: true });

  return {
    async put(key, body) {
      await fs.writeFile(join(dir, key), body);
      return `${urlPrefix}/${key}`;
    },
  };
}
