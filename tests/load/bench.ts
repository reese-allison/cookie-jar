/**
 * Bun-based benchmark: simulates N rooms × M users doing realistic realtime
 * traffic (cursor moves, occasional note add/pull, drag bursts) and reports
 * server-side resource use + client-side latency distributions.
 *
 * Use this to size a Fly.io machine: we watch RSS + CPU of the server under
 * the target load, then pick the smallest VM that stays comfortably under.
 *
 * Usage (from repo root, with Postgres + Redis up):
 *   bun src/server/index.ts &                       # start server
 *   bun tests/load/bench.ts --rooms 50 --per-room 5 --duration 60
 */

import { execSync } from "node:child_process";
import pg from "pg";
import { io as ioClient, type Socket } from "socket.io-client";
import { buildPoolConfig } from "../../src/server/db/pool";
import * as jarQueries from "../../src/server/db/queries/jars";
import * as roomQueries from "../../src/server/db/queries/rooms";
import * as userQueries from "../../src/server/db/queries/users";
import type { ClientToServerEvents, ServerToClientEvents } from "../../src/shared/types";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Args {
  rooms: number;
  perRoom: number;
  duration: number;
  baseUrl: string;
}

function parseArgs(): Args {
  const defaults: Args = {
    rooms: 50,
    perRoom: 5,
    duration: 60,
    baseUrl: "http://localhost:3001",
  };
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  return {
    rooms: Number.parseInt(get("--rooms") ?? "", 10) || defaults.rooms,
    perRoom: Number.parseInt(get("--per-room") ?? "", 10) || defaults.perRoom,
    duration: Number.parseInt(get("--duration") ?? "", 10) || defaults.duration,
    baseUrl: get("--base-url") ?? defaults.baseUrl,
  };
}

interface Sample {
  elapsedSec: number;
  rssMB: number;
  cpuPct: number;
}

function findServerPid(baseUrl: string): number | null {
  const url = new URL(baseUrl);
  const port = url.port || "3001";
  try {
    const out = execSync(`lsof -i TCP:${port} -sTCP:LISTEN -t 2>/dev/null`).toString().trim();
    if (!out) return null;
    return Number.parseInt(out.split(/\s+/)[0], 10) || null;
  } catch {
    return null;
  }
}

function sampleProcess(pid: number): Sample | null {
  try {
    const out = execSync(`ps -p ${pid} -o rss=,%cpu=`).toString().trim();
    if (!out) return null;
    const [rssKb, cpu] = out.split(/\s+/);
    return {
      elapsedSec: 0,
      rssMB: Math.round((Number.parseInt(rssKb, 10) / 1024) * 10) / 10,
      cpuPct: Math.round(Number.parseFloat(cpu) * 10) / 10,
    };
  } catch {
    return null;
  }
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

async function seedRooms(pool: pg.Pool, count: number): Promise<string[]> {
  const user = await userQueries.createUser(pool, {
    displayName: "Bench Owner",
    email: `bench-owner-${Date.now()}@example.com`,
  });
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const jar = await jarQueries.createJar(pool, {
      ownerId: user.id,
      name: `Bench Jar ${i}`,
    });
    // Seed a handful of notes per jar so note:pull has something to pull.
    for (let n = 0; n < 20; n += 1) {
      await pool.query("INSERT INTO notes (jar_id, text, style) VALUES ($1, $2, $3)", [
        jar.id,
        `Bench note ${n}`,
        "sticky",
      ]);
    }
    const room = await roomQueries.createRoom(pool, { jarId: jar.id });
    codes.push(room.code);
  }
  return codes;
}

async function cleanupBenchData(pool: pg.Pool): Promise<void> {
  // Owner cleanup cascades to jars → rooms → notes.
  await pool.query("DELETE FROM users WHERE email LIKE 'bench-owner-%@example.com'");
}

interface ClientCtx {
  socket: ClientSocket;
  pullLatencies: number[];
  addLatencies: number[];
  connectLatencyMs: number;
  disconnects: number;
  errors: number;
}

function randomXY(): { x: number; y: number } {
  return { x: Math.random() * 1000, y: Math.random() * 700 };
}

async function signInAnonymously(baseUrl: string): Promise<string> {
  // Dev-only anonymous sign-in — gives us a better-auth session cookie so
  // the bench client is a contributor (note:add / note:pull gated on auth).
  const res = await fetch(`${baseUrl}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`anon sign-in failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no cookie on anon sign-in");
  // node fetch returns a single concatenated Set-Cookie; pull out the
  // session-token cookie's name=value pair.
  const match = setCookie.match(/better-auth\.session_token=[^;]+/);
  if (!match) throw new Error(`no session cookie in: ${setCookie}`);
  return match[0];
}

async function spawnClient(
  baseUrl: string,
  roomCode: string,
  displayName: string,
  cookie: string,
): Promise<ClientCtx> {
  const start = performance.now();
  const socket: ClientSocket = ioClient(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    timeout: 10_000,
    extraHeaders: { cookie },
  });
  const ctx: ClientCtx = {
    socket,
    pullLatencies: [],
    addLatencies: [],
    connectLatencyMs: 0,
    disconnects: 0,
    errors: 0,
  };
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`connect timeout: ${displayName}`)), 10_000);
    socket.on("connect", () => {
      clearTimeout(t);
      ctx.connectLatencyMs = performance.now() - start;
      resolve();
    });
    socket.on("connect_error", (err) => {
      clearTimeout(t);
      ctx.errors += 1;
      reject(err);
    });
  });
  socket.emit("room:join", roomCode, displayName);
  socket.on("disconnect", () => {
    ctx.disconnects += 1;
  });
  socket.on("room:error", () => {
    ctx.errors += 1;
  });
  return ctx;
}

/**
 * One client's lifecycle: cursor every 66 ms, occasional note:add (every
 * ~10 s, the first user in each room), occasional note:pull (every ~8 s,
 * second user in each room). Mirrors an active Jackbox-style session.
 */
function driveClient(
  ctx: ClientCtx,
  role: "presenter" | "puller" | "observer",
  durationMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const intervals: ReturnType<typeof setInterval>[] = [];
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // Cursor stream
    intervals.push(
      setInterval(() => {
        ctx.socket.emit("cursor:move", randomXY());
      }, 66),
    );

    // Occasional note activity, attributed to role so we don't pile every user
    // onto the DB hot path at once.
    if (role === "presenter") {
      // Match emit → first note:added that follows. Presenter only fires
      // one every 10 s so windowing isn't needed — next-ack-wins is accurate.
      let lastAddSent = 0;
      let seq = 0;
      ctx.socket.on("note:added", () => {
        if (lastAddSent > 0) {
          ctx.addLatencies.push(performance.now() - lastAddSent);
          lastAddSent = 0;
        }
      });
      intervals.push(
        setInterval(() => {
          lastAddSent = performance.now();
          ctx.socket.emit("note:add", {
            text: `bench ${seq++}`,
            style: "sticky",
          });
        }, 10_000),
      );
    } else if (role === "puller") {
      let lastPullSent = 0;
      ctx.socket.on("note:pulled", () => {
        if (lastPullSent > 0) {
          ctx.pullLatencies.push(performance.now() - lastPullSent);
          lastPullSent = 0;
        }
      });
      intervals.push(
        setInterval(() => {
          lastPullSent = performance.now();
          ctx.socket.emit("note:pull");
        }, 8_000),
      );
    }

    timeouts.push(
      setTimeout(() => {
        for (const i of intervals) clearInterval(i);
        for (const t of timeouts) clearTimeout(t);
        ctx.socket.disconnect();
        resolve();
      }, durationMs),
    );
  });
}

async function main() {
  const args = parseArgs();
  const pool = new pg.Pool(buildPoolConfig());

  const serverPid = findServerPid(args.baseUrl);
  if (!serverPid) {
    console.error(`Could not find server PID at ${args.baseUrl}. Start the server first.`);
    process.exit(1);
  }

  console.log(`\n=== Cookie Jar bench ===`);
  console.log(`rooms=${args.rooms}  per-room=${args.perRoom}  duration=${args.duration}s`);
  console.log(`target=${args.baseUrl}  server pid=${serverPid}`);

  const baseline = sampleProcess(serverPid);
  console.log(`baseline RSS=${baseline?.rssMB}MB CPU=${baseline?.cpuPct}%\n`);

  console.log("Seeding rooms...");
  const codes = await seedRooms(pool, args.rooms);
  console.log(`Seeded ${codes.length} rooms. First few codes: ${codes.slice(0, 3).join(", ")}\n`);

  // Connect phase — stagger to avoid handshake thundering herd. Each client
  // hits the anonymous sign-in endpoint first so they're authenticated
  // contributors (note:add / note:pull require auth).
  console.log("Connecting clients (with anon sign-in)...");
  const connectStart = performance.now();
  const ctxs: ClientCtx[] = [];
  for (let r = 0; r < codes.length; r += 1) {
    const roomCtxs = await Promise.all(
      Array.from({ length: args.perRoom }, async (_, u) => {
        try {
          const cookie = await signInAnonymously(args.baseUrl);
          return await spawnClient(args.baseUrl, codes[r], `u-${r}-${u}`, cookie);
        } catch (err) {
          console.error(`client ${r}-${u} setup failed:`, (err as Error).message);
          return null;
        }
      }),
    );
    for (const c of roomCtxs) if (c) ctxs.push(c);
    // Small pause per room so we're not spamming the handshake path.
    await new Promise((r) => setTimeout(r, 10));
  }
  const connectMs = performance.now() - connectStart;
  console.log(
    `Connected ${ctxs.length}/${args.rooms * args.perRoom} clients in ${connectMs.toFixed(0)}ms`,
  );
  console.log(
    `connect p50=${pct(
      ctxs.map((c) => c.connectLatencyMs),
      0.5,
    ).toFixed(0)}ms ` +
      `p95=${pct(
        ctxs.map((c) => c.connectLatencyMs),
        0.95,
      ).toFixed(0)}ms\n`,
  );

  // Sample server every second while clients are active.
  const samples: Sample[] = [];
  const sampleStart = performance.now();
  const sampler = setInterval(() => {
    const s = sampleProcess(serverPid);
    if (s) samples.push({ ...s, elapsedSec: (performance.now() - sampleStart) / 1000 });
  }, 1000);

  // Drive clients.
  console.log(`Driving traffic for ${args.duration}s...`);
  const durationMs = args.duration * 1000;
  const driven = ctxs.map((ctx, i) => {
    // First user per room is the presenter (notes in), second is the puller,
    // rest are observers. Spreads DB load across the bench.
    const roomIdx = Math.floor(i / args.perRoom);
    const withinRoom = i - roomIdx * args.perRoom;
    const role = withinRoom === 0 ? "presenter" : withinRoom === 1 ? "puller" : "observer";
    return driveClient(ctx, role, durationMs);
  });
  await Promise.all(driven);
  clearInterval(sampler);

  const allAdd = ctxs.flatMap((c) => c.addLatencies);
  const allPull = ctxs.flatMap((c) => c.pullLatencies);
  const disconnects = ctxs.reduce((acc, c) => acc + c.disconnects, 0);
  const errors = ctxs.reduce((acc, c) => acc + c.errors, 0);

  const rssMin = Math.min(...samples.map((s) => s.rssMB));
  const rssMax = Math.max(...samples.map((s) => s.rssMB));
  const rssAvg = samples.reduce((a, s) => a + s.rssMB, 0) / samples.length;
  const cpuMax = Math.max(...samples.map((s) => s.cpuPct));
  const cpuAvg = samples.reduce((a, s) => a + s.cpuPct, 0) / samples.length;

  console.log("\n=== Results ===");
  console.log(`Clients:       ${ctxs.length} connected, ${errors} errors, ${disconnects} dropped`);
  console.log(
    `note:add RTT:  p50=${pct(allAdd, 0.5).toFixed(1)}ms p95=${pct(allAdd, 0.95).toFixed(1)}ms (n=${allAdd.length})`,
  );
  console.log(
    `note:pull RTT: p50=${pct(allPull, 0.5).toFixed(1)}ms p95=${pct(allPull, 0.95).toFixed(1)}ms (n=${allPull.length})`,
  );
  console.log(`Server RSS:    min=${rssMin}MB avg=${rssAvg.toFixed(1)}MB max=${rssMax}MB`);
  console.log(`Server CPU:    avg=${cpuAvg.toFixed(1)}% max=${cpuMax.toFixed(1)}%`);
  console.log(
    `Baseline RSS:  ${baseline?.rssMB}MB  →  delta ${(rssMax - (baseline?.rssMB ?? 0)).toFixed(1)}MB`,
  );

  console.log("\nCleaning up bench data...");
  await cleanupBenchData(pool);
  await pool.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
