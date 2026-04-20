import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { type AuthenticatedRequest, requireAuth } from "../middleware/requireAuth";
import { extForMime, type Storage } from "../storage";

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

export function createUploadRouter(storage: Storage): Router {
  const router = Router();
  router.post("/", requireAuth, upload.single("file"), async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    try {
      const key = `${randomUUID()}${extForMime(req.file.mimetype)}`;
      const url = await storage.put(key, req.file.buffer, req.file.mimetype);
      res.status(201).json({ url });
    } catch {
      res.status(500).json({ error: "Failed to store upload" });
    }
  });
  return router;
}
