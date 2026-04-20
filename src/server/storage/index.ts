import { resolve } from "node:path";
import { createLocalDiskStorage } from "./LocalDiskStorage";
import { createS3Storage } from "./S3Storage";
import type { Storage } from "./Storage";

export { createLocalDiskStorage } from "./LocalDiskStorage";
export { createS3Storage } from "./S3Storage";
export type { Storage } from "./Storage";
export { extForMime, MIME_TO_EXT } from "./Storage";

/**
 * Chooses a storage backend from env. Defaults to local disk so dev doesn't
 * need any AWS credentials.
 *
 * STORAGE_BACKEND=local|s3 (default local)
 * For s3:
 *   S3_BUCKET (required)
 *   S3_REGION (default "auto" — R2)
 *   S3_ENDPOINT (required for R2, optional for AWS)
 *   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (required)
 *   S3_PUBLIC_URL_BASE (optional — custom domain; defaults to endpoint/bucket)
 */
export function buildStorageFromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
  const backend = (env.STORAGE_BACKEND ?? "local").toLowerCase();
  if (backend === "s3") {
    const bucket = env.S3_BUCKET;
    const accessKeyId = env.S3_ACCESS_KEY_ID;
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY must be set when STORAGE_BACKEND=s3",
      );
    }
    return createS3Storage({
      bucket,
      region: env.S3_REGION ?? "auto",
      endpoint: env.S3_ENDPOINT,
      accessKeyId,
      secretAccessKey,
      publicUrlBase: env.S3_PUBLIC_URL_BASE,
    });
  }
  return createLocalDiskStorage(resolve(env.UPLOAD_DIR ?? "public/uploads"));
}
