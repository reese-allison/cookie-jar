# Load tests

k6 scripts for shaking the backend under traffic that a real Jackbox-style session would throw at it. Not part of the Vitest suite — run manually against a running server.

## Prereqs

- [k6](https://k6.io/docs/getting-started/installation/) installed (`brew install k6`)
- Server reachable at `BASE_URL` with its dependencies (Postgres, Redis) up

## Scenarios

### `cursors.js` — Socket.io cursor traffic

Ramps 500 concurrent virtual users across 10 rooms, streaming `cursor:move` at ~15 Hz for one minute. Tests the socket dedup / presence / volatile-broadcast path.

```bash
# Create test rooms first (e.g. via the app UI or a DB seed)
k6 run tests/load/cursors.js \
  -e BASE_URL=http://localhost:3001 \
  -e ROOM_CODES=AAA111,BBB222,CCC333,DDD444,EEE555,FFF666,GGG777,HHH888,III999,JJJ000
```

**Check:** `p(95) ws_connecting < 2000ms`, `checks > 95%`.

### `uploads.js` — Upload burst

Fires 20 uploads/sec for 30 seconds against `/api/uploads`. Exercises the REST rate limiter, multer memory pipeline, and Storage backend (local disk or R2 depending on env).

```bash
# Sign in via the UI first, copy the better-auth session cookie from DevTools
k6 run tests/load/uploads.js \
  -e BASE_URL=http://localhost:3001 \
  -e COOKIE='better-auth.session_token=...'
```

**Check:** all responses are either 201 or 429. `p(95) http_req_duration < 1000ms` for 201s.

## Baselines

Record fresh numbers here after any Phase 3 / Phase 4 perf change so we can detect regressions.

| Run date | Scenario | p50 (ms) | p95 (ms) | Error rate | Notes |
|---|---|---|---|---|---|
| _pending first run_ | cursors | — | — | — | — |
| _pending first run_ | uploads | — | — | — | — |
