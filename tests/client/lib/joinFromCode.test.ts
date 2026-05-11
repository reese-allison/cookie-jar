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
  it("resolves the code as a jar share-code and opens a room on that jar", async () => {
    mockFetch(200, { id: "jar-abc", shareCode: "ABCDEFG" });
    const openRoomForJar = vi.fn().mockResolvedValue(undefined);
    const setError = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, setError });
    await join("ABCDEFG", "Alex");

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/jars/by-share-code/ABCDEFG", {
      credentials: "include",
    });
    expect(openRoomForJar).toHaveBeenCalledWith("jar-abc");
    expect(setError).not.toHaveBeenCalled();
  });

  it("surfaces a 404 as a friendly error (stale link)", async () => {
    mockFetch(404, { error: "Jar not found" });
    const openRoomForJar = vi.fn();
    const setError = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, setError });
    await join("DEADCODE", "Alex");

    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError.mock.calls[0][0]).toMatch(/no longer works|deleted/i);
  });

  it("surfaces a 403 as an allowlist-miss error", async () => {
    mockFetch(403, { error: "Not authorized" });
    const openRoomForJar = vi.fn();
    const setError = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, setError });
    await join("ABCDEFG", "Alex");

    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError.mock.calls[0][0]).toMatch(/allowlist|invite/i);
  });

  it("surfaces a network failure as a connection error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const openRoomForJar = vi.fn();
    const setError = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, setError });
    await join("ABCDEFG", "Alex");

    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError.mock.calls[0][0]).toMatch(/connection|reach the server/i);
  });
});
