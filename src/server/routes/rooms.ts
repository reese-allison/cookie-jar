import { Router } from "express";

export const roomRouter = Router();

// Placeholder — room routes will be implemented in Phase 2 (real-time core)
roomRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
