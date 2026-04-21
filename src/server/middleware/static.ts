import compression from "compression";
import express, { type RequestHandler } from "express";

export function buildCompression(): RequestHandler {
  return compression();
}

// Sounds have stable filenames that may be replaced with new content on deploy,
// so we allow caching but not `immutable`.
export function buildSoundsStatic(dir: string): RequestHandler {
  return express.static(dir, {
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    },
  });
}
