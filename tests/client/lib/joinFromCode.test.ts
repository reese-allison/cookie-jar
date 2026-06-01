/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJoinFromCode } from "../../../src/client/lib/joinFromCode";

const origFetch = globalThis.fetch;

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  globalThis.fetch = origFetch;
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Sensible authed defaults; override per test. */
function makeDeps(overrides: Partial<Parameters<typeof createJoinFromCode>[0]> = {}) {
  return {
    joinRoom: vi.fn(),
    openRoomForJar: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(),
    isAuthenticated: true,
    requestSignIn: vi.fn(),
    ...overrides,
  };
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
    const deps = makeDeps({ isAuthenticated: false });

    const join = createJoinFromCode(deps);
    await join("ABCDEFG", "Alex");

    expect(deps.joinRoom).toHaveBeenCalledWith("room-active-uuid", "Alex");
    expect(deps.openRoomForJar).not.toHaveBeenCalled();
    expect(deps.requestSignIn).not.toHaveBeenCalled();
    expect(deps.setError).not.toHaveBeenCalled();
  });

  it("opens a new room when activeRoomId is null and the user is authed", async () => {
    mockFetch(200, { id: "jar-abc", shareCode: "ABCDEFG", activeRoomId: null });
    const deps = makeDeps({ isAuthenticated: true });

    const join = createJoinFromCode(deps);
    await join("ABCDEFG", "Alex");

    expect(deps.openRoomForJar).toHaveBeenCalledWith("jar-abc");
    expect(deps.joinRoom).not.toHaveBeenCalled();
    expect(deps.requestSignIn).not.toHaveBeenCalled();
    expect(deps.setError).not.toHaveBeenCalled();
  });

  it("prompts sign-in (not a dead-end 401) when activeRoomId is null and the visitor is anonymous", async () => {
    // Opening a brand-new room is auth-gated (POST /api/rooms → 401 for anon).
    // Rather than firing that doomed request and surfacing a bare error toast,
    // an anonymous deep-linker should be offered sign-in directly.
    mockFetch(200, { id: "jar-abc", shareCode: "ABCDEFG", activeRoomId: null });
    const deps = makeDeps({ isAuthenticated: false });

    const join = createJoinFromCode(deps);
    await join("ABCDEFG", "Alex");

    expect(deps.requestSignIn).toHaveBeenCalledTimes(1);
    expect(deps.openRoomForJar).not.toHaveBeenCalled();
    expect(deps.joinRoom).not.toHaveBeenCalled();
    expect(deps.setError).not.toHaveBeenCalled();
  });

  it("writes the share-code into the URL before prompting sign-in so the OAuth round-trip returns to the room", async () => {
    // The visitor may have typed the code into the landing form while the URL
    // still reads "/". For AuthButtons' full-path callbackURL to bring them
    // back to *this* jar after OAuth, the code has to be in the address bar
    // before the modal opens. We write the canonical shareCode, not the raw
    // (possibly lowercase) input.
    mockFetch(200, { id: "jar-abc", shareCode: "ABCDEFG", activeRoomId: null });
    const deps = makeDeps({ isAuthenticated: false });

    const join = createJoinFromCode(deps);
    await join("abcdefg", "Alex");

    expect(window.location.pathname).toBe("/ABCDEFG");
    expect(deps.requestSignIn).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 404 as a friendly error (stale link)", async () => {
    mockFetch(404, { error: "Jar not found" });
    const deps = makeDeps();

    const join = createJoinFromCode(deps);
    await join("DEADCODE", "Alex");

    expect(deps.openRoomForJar).not.toHaveBeenCalled();
    expect(deps.joinRoom).not.toHaveBeenCalled();
    expect(deps.requestSignIn).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledTimes(1);
    expect(deps.setError.mock.calls[0][0]).toMatch(/no longer works|deleted/i);
  });

  it("surfaces a 403 as an allowlist-miss error", async () => {
    mockFetch(403, { error: "Not authorized" });
    const deps = makeDeps();

    const join = createJoinFromCode(deps);
    await join("ABCDEFG", "Alex");

    expect(deps.openRoomForJar).not.toHaveBeenCalled();
    expect(deps.joinRoom).not.toHaveBeenCalled();
    expect(deps.requestSignIn).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledTimes(1);
    expect(deps.setError.mock.calls[0][0]).toMatch(/allowlist|invite/i);
  });

  it("encodeURIComponents the code before putting it in the URL (defense in depth)", async () => {
    // parseCodeFromPath already restricts to ROOM_CODE_CHARS, but the
    // helper shouldn't trust its caller — encoding ensures a future caller
    // that bypasses the parser can't smuggle path segments.
    mockFetch(200, { id: "jar-x", shareCode: "ABCDEFG", activeRoomId: null });
    const deps = makeDeps({ isAuthenticated: true });
    const join = createJoinFromCode(deps);
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
    const deps = makeDeps({
      isAuthenticated: true,
      openRoomForJar: vi.fn().mockRejectedValue(new Error("simulated breakage")),
    });
    const join = createJoinFromCode(deps);
    await expect(join("ABCDEFG", "Alex")).resolves.toBeUndefined();
    expect(deps.setError).toHaveBeenCalledTimes(1);
  });

  it("surfaces a network failure as a connection error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const deps = makeDeps();

    const join = createJoinFromCode(deps);
    await join("ABCDEFG", "Alex");

    expect(deps.openRoomForJar).not.toHaveBeenCalled();
    expect(deps.joinRoom).not.toHaveBeenCalled();
    expect(deps.requestSignIn).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledTimes(1);
    expect(deps.setError.mock.calls[0][0]).toMatch(/connection|reach the server/i);
  });
});
