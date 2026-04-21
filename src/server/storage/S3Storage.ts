import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Storage } from "./Storage";

export interface S3StorageConfig {
  bucket: string;
  /** For R2 this is https://{accountId}.r2.cloudflarestorage.com. Optional for AWS. */
  endpoint?: string;
  /** R2 convention is "auto". AWS uses real region codes. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * The base URL clients fetch from. For R2 this is usually a custom domain
   * (https://cdn.example.com); for AWS it's the public bucket URL. Falls back
   * to `${endpoint}/${bucket}` if not provided.
   */
  publicUrlBase?: string;
}

export function createS3Storage(cfg: S3StorageConfig, client?: S3Client): Storage {
  const s3 =
    client ??
    new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });

  const publicBase =
    cfg.publicUrlBase ?? (cfg.endpoint ? `${cfg.endpoint}/${cfg.bucket}` : `/${cfg.bucket}`);

  return {
    async put(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Content-addressed keys never change — give clients a year of cache.
          CacheControl: "public, max-age=31536000, immutable",
          // R2 ignores ACL entirely (objects inherit bucket visibility). On
          // AWS, public-read is required for clients to load the URL without
          // presigning — if the bucket's block-public-access is on, this call
          // fails loud and ops can flip the right bucket setting, which is
          // better than silent 403s when the UI tries to render an upload.
          ACL: "public-read",
        }),
      );
      return `${publicBase}/${key}`;
    },
  };
}
