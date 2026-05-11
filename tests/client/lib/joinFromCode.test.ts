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
    const joinRoom = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, joinRoom });
    await join("ABCDEFG", "Alex");

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/jars/by-share-code/ABCDEFG", {
      credentials: "include",
    });
    expect(openRoomForJar).toHaveBeenCalledWith("jar-abc");
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it("falls back to direct joinRoom when the code is not a known share-code (404)", async () => {
    mockFetch(404, { error: "Jar not found" });
    const openRoomForJar = vi.fn().mockResolvedValue(undefined);
    const joinRoom = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, joinRoom });
    await join("LEGACY1", "Alex");

    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(joinRoom).toHaveBeenCalledWith("LEGACY1", "Alex");
  });

  it("falls back to direct joinRoom on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const openRoomForJar = vi.fn();
    const joinRoom = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, joinRoom });
    await join("ABCDEFG", "Alex");

    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(joinRoom).toHaveBeenCalledWith("ABCDEFG", "Alex");
  });

  it("does not call openRoomForJar for non-200 non-404 (e.g. 403 allowlist miss) — falls back to joinRoom", async () => {
    // 403 means "the code matches a jar but you can't access it." Falling
    // back to joinRoom lets the server emit room:error via the socket path,
    // so the user gets a single consistent error toast either way.
    mockFetch(403, { error: "Not authorized" });
    const openRoomForJar = vi.fn();
    const joinRoom = vi.fn();

    const join = createJoinFromCode({ openRoomForJar, joinRoom });
    await join("ABCDEFG", "Alex");

    expect(openRoomForJar).not.toHaveBeenCalled();
    expect(joinRoom).toHaveBeenCalledWith("ABCDEFG", "Alex");
  });
});
