import { check, sleep } from "k6";
import http from "k6/http";
import ws from "k6/ws";

/**
 * Load test: steady-state cursor traffic.
 *
 *   500 concurrent virtual users spread across 10 rooms (50/room). Each user
 *   opens a WebSocket, joins a room, streams cursor:move at ~15 Hz for 60 s,
 *   then disconnects. Measures socket handshake latency + message throughput.
 *
 * Prereq: target server running + 10 rooms already created.
 * Run:   k6 run tests/load/cursors.js -e BASE_URL=http://localhost:3001 -e ROOM_CODES=AAA,BBB,...
 */

export const options = {
  scenarios: {
    cursors: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 500 },
        { duration: "45s", target: 500 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    checks: ["rate>0.95"],
    ws_connecting: ["p(95)<2000"],
  },
};

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:3001";
const WS_URL = BASE_URL.replace(/^http/, "ws");
const ROOM_CODES = (__ENV.ROOM_CODES ?? "").split(",").filter(Boolean);

if (ROOM_CODES.length === 0) {
  throw new Error("Set ROOM_CODES=AAA,BBB,... (rooms must already exist on the target server)");
}

export default function () {
  // Sanity check: server is up before we try to WebSocket.
  const liveRes = http.get(`${BASE_URL}/api/live`);
  check(liveRes, { "server live": (r) => r.status === 200 });

  const room = ROOM_CODES[__VU % ROOM_CODES.length];

  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket`;
  const res = ws.connect(url, null, (socket) => {
    socket.on("open", () => {
      // Socket.io v4 engine.io handshake. k6 doesn't ship a Socket.io client,
      // so we speak the protocol directly. 40 = connect packet.
      socket.send("40");
      socket.send(`42["room:join","${room}","vu-${__VU}"]`);

      // Cursor updates at ~15 Hz for the duration of the test VU's lifetime.
      socket.setInterval(() => {
        const x = Math.random() * 1000;
        const y = Math.random() * 700;
        socket.send(`42["cursor:move",{"x":${x},"y":${y}}]`);
      }, 66);
    });

    socket.on("close", () => {
      // Ramp-down closes the socket; nothing to do.
    });

    socket.setTimeout(() => socket.close(), 60_000);
  });

  check(res, { "ws connected": (r) => r && r.status === 101 });
  sleep(1);
}
