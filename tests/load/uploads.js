import { check } from "k6";
import http from "k6/http";

/**
 * Load test: upload burst.
 *
 *   100 concurrent virtual users uploading a small PNG each in quick
 *   succession. Exercises the rate limit (10/min), multer memory pipeline,
 *   and Storage put (local disk in dev or R2 if configured via env).
 *
 * Expects at least 10 uploads to get through and the rest to 429. Use this
 * to confirm rate-limit headers + behavior match reality.
 *
 * Run: k6 run tests/load/uploads.js -e BASE_URL=http://localhost:3001 -e COOKIE='...'
 *
 * COOKIE must be a valid better-auth session cookie (copy from browser
 * DevTools after signing in locally).
 */

export const options = {
  scenarios: {
    uploads: {
      executor: "ramping-arrival-rate",
      startRate: 0,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      stages: [
        { duration: "10s", target: 20 }, // 20 requests/sec
        { duration: "20s", target: 20 },
      ],
    },
  },
  thresholds: {
    "http_req_duration{status:201}": ["p(95)<1000"],
  },
};

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:3001";
const COOKIE = __ENV.COOKIE ?? "";

// 1x1 transparent PNG — minimal valid upload payload.
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export default function () {
  const headers = COOKIE ? { Cookie: COOKIE } : {};
  const body = { file: http.file(PNG_1X1, "pixel.png", "image/png") };
  const res = http.post(`${BASE_URL}/api/uploads`, body, { headers });

  check(res, {
    "201 or 429": (r) => r.status === 201 || r.status === 429,
    "has rate limit header": (r) => r.headers["Ratelimit-Limit"] !== undefined,
  });
}
