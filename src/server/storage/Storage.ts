export interface Storage {
  /**
   * Stores `body` under `key` and returns the URL clients should load it from.
   * For local disk this is `/uploads/<key>`; for S3/R2 it's the bucket's
   * public URL (custom domain or {endpoint}/{bucket}/{key}).
   */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

/** MIME → extension map used when generating content-addressed keys. */
export const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
};

export function extForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? ".bin";
}
