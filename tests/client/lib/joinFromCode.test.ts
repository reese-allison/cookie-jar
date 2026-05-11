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
