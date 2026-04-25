/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJarActions } from "../../../src/client/hooks/useJarActions";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function setupHook(overrides: Partial<Parameters<typeof useJarActions>[0]> = {}) {
  const joinRoom = overrides.joinRoom ?? vi.fn();
  const setError = overrides.setError ?? vi.fn();
  const displayName = overrides.displayName ?? "Alice";
  const { result } = renderHook(() => useJarActions({ displayName, joinRoom, setError }));
  return { result, joinRoom, setError };
}

function okJson(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

describe("useJarActions.openRoomForJar", () => {
  it("creates a room and joins it with the user's display name", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ code: "ROOM01" }));
    const { result, joinRoom, setError } = setupHook();
    await act(async () => {
      await result.current.openRoomForJar("jar-1");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ jarId: "jar-1" }),
      }),
    );
    expect(joinRoom).toHaveBeenCalledWith("ROOM01", "Alice");
    expect(setError).not.toHaveBeenCalled();
  });

  it("surfaces the server error when room creation fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Jar is locked" }),
    });
    const { result, joinRoom, setError } = setupHook();
    await act(async () => {
      await result.current.openRoomForJar("j1");
    });
    expect(setError).toHaveBeenCalledWith("Jar is locked");
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it("falls back to a generic error message when the body is unparseable", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error("not json");
      },
    });
    const { result, setError } = setupHook();
    await act(async () => {
      await result.current.openRoomForJar("j1");
    });
    expect(setError).toHaveBeenCalledWith("Failed to create room");
  });

  it("shows a connectivity error when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { result, setError } = setupHook();
    await act(async () => {
      await result.current.openRoomForJar("j1");
    });
    expect(setError).toHaveBeenCalledWith(expect.stringMatching(/couldn't reach the server/i));
  });
});

describe("useJarActions.createJarAndJoin", () => {
  it("creates the jar then opens a room and toggles isCreating", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ id: "jar-7" })) // POST /api/jars
      .mockResolvedValueOnce(okJson({ code: "RM7777" })); // POST /api/rooms
    const { result, joinRoom } = setupHook();
    expect(result.current.isCreating).toBe(false);

    let pending: Promise<void>;
    act(() => {
      pending = result.current.createJarAndJoin("Standup");
    });
    await waitFor(() => expect(result.current.isCreating).toBe(true));
    await act(async () => {
      // biome-ignore lint/style/noNonNullAssertion: pending is set above
      await pending!;
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/jars",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Standup" }) }),
    );
    expect(joinRoom).toHaveBeenCalledWith("RM7777", "Alice");
    expect(result.current.isCreating).toBe(false);
  });

  it("reports the jar-creation error and skips the room call", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Name required" }),
    });
    const { result, joinRoom, setError } = setupHook();
    await act(async () => {
      await result.current.createJarAndJoin("");
    });
    expect(setError).toHaveBeenCalledWith("Name required");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(joinRoom).not.toHaveBeenCalled();
    expect(result.current.isCreating).toBe(false);
  });

  it("clears isCreating even when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("kaboom"));
    const { result, setError } = setupHook();
    await act(async () => {
      await result.current.createJarAndJoin("Something");
    });
    expect(setError).toHaveBeenCalledWith("Something went wrong");
    expect(result.current.isCreating).toBe(false);
  });
});

describe("useJarActions.cloneTemplateAndJoin", () => {
  it("clones the template then opens a room", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ id: "clone-1" }))
      .mockResolvedValueOnce(okJson({ code: "CLN001" }));
    const { result, joinRoom } = setupHook();
    await act(async () => {
      await result.current.cloneTemplateAndJoin("template-x");
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/jars/template-x/clone",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(joinRoom).toHaveBeenCalledWith("CLN001", "Alice");
  });

  it("reports the clone error and skips the room call", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Forbidden" }) });
    const { result, joinRoom, setError } = setupHook();
    await act(async () => {
      await result.current.cloneTemplateAndJoin("template-x");
    });
    expect(setError).toHaveBeenCalledWith("Forbidden");
    expect(joinRoom).not.toHaveBeenCalled();
  });
});
