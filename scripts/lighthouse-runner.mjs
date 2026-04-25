#!/usr/bin/env node
// Lighthouse runner — designed to execute inside the Dockerfile.lighthouse
// sandbox. Serves the prebuilt `dist/` from the working directory, launches a
// pinned Chromium, runs Lighthouse against each URL, and emits a single
// JSON line on stdout for the host-side spec to parse.
//
// All progress logs go to stderr so stdout stays a clean JSON channel.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const PORT = 8080;
const HOST = "127.0.0.1";

const URLS = (process.env.LIGHTHOUSE_URLS ?? "/")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

const INCLUDE_PWA = process.env.LIGHTHOUSE_INCLUDE_PWA === "1";
const CATEGORIES = INCLUDE_PWA
  ? ["performance", "accessibility", "best-practices", "seo", "pwa"]
  : ["performance", "accessibility", "best-practices", "seo"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

// SPA static server: serve files from dist/, fall back to index.html. Mirrors
// production: gzip compresses text responses, hashed asset filenames get
// `immutable` cache headers (matching how Vite-built assets are served behind
// any reasonable CDN). Without these, Lighthouse flags "use efficient cache
// lifetimes" and "enable text compression" — but those would be false positives
// against the real deployment.
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?)$/;
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|manifest\+json|xml))/;

function startStaticServer() {
  const indexPath = path.join(DIST_DIR, "index.html");
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    let filePath = path.join(DIST_DIR, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403).end();
      return;
    }
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      filePath = indexPath;
      stat = statSync(filePath);
    }
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      try {
        stat = statSync(filePath);
      } catch {
        filePath = indexPath;
        stat = statSync(filePath);
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    const acceptsGzip = (req.headers["accept-encoding"] ?? "").includes("gzip");
    const shouldCompress = acceptsGzip && COMPRESSIBLE.test(contentType);
    const cacheControl = HASHED_ASSET.test(filePath)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300, must-revalidate";

    const headers = {
      "content-type": contentType,
      "cache-control": cacheControl,
    };

    if (shouldCompress) {
      res.writeHead(200, { ...headers, "content-encoding": "gzip", vary: "Accept-Encoding" });
      createReadStream(filePath).pipe(createGzip()).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "content-length": stat.size });
      createReadStream(filePath).pipe(res);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

async function runOnce(targetUrl, chromePort) {
  const result = await lighthouse(targetUrl, {
    port: chromePort,
    output: "json",
    logLevel: "error",
    onlyCategories: CATEGORIES,
  });
  if (!result?.lhr) throw new Error(`Lighthouse returned no report for ${targetUrl}`);
  const scores = {};
  for (const [key, cat] of Object.entries(result.lhr.categories)) {
    scores[key] = cat.score;
  }
  return scores;
}

async function main() {
  const server = await startStaticServer();
  process.stderr.write(`[lighthouse-runner] static server on http://${HOST}:${PORT}\n`);

  const chrome = await chromeLauncher.launch({
    chromePath: process.env.CHROME_PATH || undefined,
    chromeFlags: [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  process.stderr.write(`[lighthouse-runner] chrome on port ${chrome.port}\n`);

  const results = [];
  try {
    for (const pathname of URLS) {
      const targetUrl = `http://${HOST}:${PORT}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
      process.stderr.write(`[lighthouse-runner] auditing ${targetUrl}\n`);
      const scores = await runOnce(targetUrl, chrome.port);
      results.push({ url: pathname, scores });
    }
  } finally {
    chrome.kill();
    server.close();
  }

  process.stdout.write(`${JSON.stringify(results)}\n`);
}

main().catch((err) => {
  process.stderr.write(`[lighthouse-runner] FAILED: ${err?.stack ?? err}\n`);
  process.exit(1);
});
