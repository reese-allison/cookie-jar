import { createHash } from "node:crypto";
import { Router } from "express";
import type Redis from "ioredis";
import multer from "multer";
import { logger } from "../logger";
import { type AuthenticatedRequest, getUser, requireAuth } from "../middleware/requireAuth";
import { extForMime, type Storage } from "../storage";
import { sniffMime } from "../storage/sniff";

// SVG intentionally excluded — served from /uploads/ with its native MIME a
// malicious SVG can execute inline <script> in the browsing context.
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// Per-user upload quota, sliding 24-hour window. Caps bytes (not count) so a
// user can upload many small images without tripping on a handful of large
// audio files. 100 MB comfortably fits a typical jar's full set of assets
// plus room for re-uploads; beyond that we 413.
const QUOTA_BYTES_PER_DAY = 100 * 1024 * 1024;
const QUOTA_WINDOW_SECONDS = 24 * 60 * 60;

const upload = multer({
  // Keep files in memory: the Storage abstraction needs a Buffer so it can
  // write to either disk or S3/R2 without spilling temp files we'd need to
  // clean up after.
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image and audio files are allowed"));
    }
  },
});

/** Optional quota checker — omit when a caller (tests) doesn't care. */
export interface UploadQuota {
  /**
   * Returns true when `userId`'s remaining daily budget covers `bytes`, and
   * reserves those bytes against the quota. Returns false when over budget
   * (the caller should 413). Implementations must be cluster-safe.
   */
  reserve(userId: string, bytes: number): Promise<boolean>;
}

export function createRedisQuota(
  redis: Redis,
  opts: { bytesPerDay?: number; windowSeconds?: number } = {},
): UploadQuota {
  const cap = opts.bytesPerDay ?? QUOTA_BYTES_PER_DAY;
  const ttl = opts.windowSeconds ?? QUOTA_WINDOW_SECONDS;
  return {
    async reserve(userId, bytes) {
      // Fixed-window counter. INCRBY returns the post-increment value so we
      // can roll back if over cap. The expire sets TTL only on first
      // INCRBY (new key); subsequent increments don't reset the window.
      const key = `uploads:quota:${userId}`;
      const after = await redis.incrby(key, bytes);
      if (after === bytes) await redis.expire(key, ttl);
      if (after > cap) {
        await redis.decrby(key, bytes);
        return false;
      }
      return true;
    },
  };
}

export function createUploadRouter(storage: Storage, quota?: UploadQuota): Router {
  const router = Router();
  router.post("/", requireAuth, upload.single("file"), async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    // Magic-byte sniff. Multer's `mimetype` is the client-supplied header — an
    // attacker can upload arbitrary HTML/JS with Content-Type: image/png. If
    // the bytes don't match an allowed type we refuse. Also reject when the
    // sniffed type disagrees with the declared type so a client can't sneak
    // e.g. an MP3 into an image/png-declared storage key.
    const sniffed = sniffMime(req.file.buffer);
    if (!sniffed || sniffed !== req.file.mimetype) {
      res.status(400).json({ error: "File contents don't match the declared type" });
      return;
    }
    if (quota) {
      const ok = await quota.reserve(getUser(req).id, req.file.buffer.length);
      if (!ok) {
        res.status(413).json({ error: "Daily upload quota exceeded" });
        return;
      }
    }
    try {
      // Content-addressed: sha256 of the bytes + mime-derived extension.
      // Same file uploaded twice = same key, dedup in storage and every
      // client gets to reuse their cache entry across users.
      const hash = createHash("sha256").update(req.file.buffer).digest("hex");
      const key = `${hash}${extForMime(sniffed)}`;
      const url = await storage.put(key, req.file.buffer, sniffed);
      res.status(201).json({ url });
    } catch (err) {
      logger.error({ err }, "POST /api/uploads failed");
      res.status(500).json({ error: "Failed to store upload" });
    }
  });
  return router;
}
