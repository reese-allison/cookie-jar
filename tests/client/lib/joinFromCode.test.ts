/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJoinFromCode } from "../../../src/client/lib/joinFromCode";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("createJoinFromCode", () => {
  it("socket-joins the active room directly when one is open (anon-safe path)", async () => {
    // Regression guard: the share-code rollout used to funnel every URL
    // resolution through openRoomForJar → POST /api/rooms, which is
    // auth-gated. Anonymous viewers clicking a share link for a live
    // session got 401. With activeRoomId surfaced, the client can
    // socket-join directly and the auth-gated create path stays out of
    // the picture.
    mockFetch(200, { id: "jar-abc", shareCode: "ABCDEFG", activeRoomId: "room-active-uuid" });
    const openRoomForJar = vi.fn();
    const joinRoom = vi.fn();
    const setError = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, joinRoom, setError });
    await join("ABCDEFG", "Alex");

    expect(joinRoom).toHaveBeenCalledWith("room-active-uuid", "Alex");
    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("opens a new room when activeRoomId is null and the user is authed", async () => {
    mockFetch(200, { id: "jar-abc", shareCode: "ABCDEFG", activeRoomId: null });
    const openRoomForJar = vi.fn().mockResolvedValue(undefined);
    const joinRoom = vi.fn();
    const setError = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, joinRoom, setError });
    await join("ABCDEFG", "Alex");

    expect(openRoomForJar).toHaveBeenCalledWith("jar-abc");
    expect(joinRoom).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("surfaces a 404 as a friendly error (stale link)", async () => {
    mockFetch(404, { error: "Jar not found" });
    const openRoomForJar = vi.fn();
    const joinRoom = vi.fn();
    const setError = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, joinRoom, setError });
    await join("DEADCODE", "Alex");

    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(joinRoom).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError.mock.calls[0][0]).toMatch(/no longer works|deleted/i);
  });

  it("surfaces a 403 as an allowlist-miss error", async () => {
    mockFetch(403, { error: "Not authorized" });
    const openRoomForJar = vi.fn();
    const joinRoom = vi.fn();
    const setError = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, joinRoom, setError });
    await join("ABCDEFG", "Alex");

    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(joinRoom).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError.mock.calls[0][0]).toMatch(/allowlist|invite/i);
  });

  it("encodeURIComponents the code before putting it in the URL (defense in depth)", async () => {
    // parseCodeFromPath already restricts to ROOM_CODE_CHARS, but the
    // helper shouldn't trust its caller — encoding ensures a future caller
    // that bypasses the parser can't smuggle path segments.
    mockFetch(200, { id: "jar-x", shareCode: "ABCDEFG", activeRoomId: null });
    const openRoomForJar = vi.fn().mockResolvedValue(undefined);
    const join = createJoinFromCode({ joinRoom: vi.fn(), openRoomForJar, setError: vi.fn() });
    await join("../etc/passwd", "Alex");
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe("/api/jars/by-share-code/..%2Fetc%2Fpasswd");
    expect(url).not.toContain("/etc/passwd");
  });

  it("recovers gracefully if openRoomForJar throws (defense in depth)", async () => {
    // openRoomForJar (from useJarActions) currently catches its own
    // errors and never rethrows. This test pins that contract from
    // joinFromCode's side: if a future refactor of openRoomForJar lets
    // a rejection escape, joinFromCode's outer try/catch swallows it
    // gracefully and surfaces a friendly setError — no console-noisy
    // unhandled-promise-rejection bubbling up to the user.
    mockFetch(200, { id: "jar-x", shareCode: "ABCDEFG", activeRoomId: null });
    const openRoomForJar = vi.fn().mockRejectedValue(new Error("simulated breakage"));
    const setError = vi.fn();
    const join = createJoinFromCode({ joinRoom: vi.fn(), openRoomForJar, setError });
    await expect(join("ABCDEFG", "Alex")).resolves.toBeUndefined();
    expect(setError).toHaveBeenCalledTimes(1);
  });

  it("surfaces a network failure as a connection error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const openRoomForJar = vi.fn();
    const joinRoom = vi.fn();
    const setError = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, joinRoom, setError });
    await join("ABCDEFG", "Alex");

    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(joinRoom).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError.mock.calls[0][0]).toMatch(/connection|reach the server/i);
  });
});
