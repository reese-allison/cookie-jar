/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteJar, fetchMyJars, starJar, unstarJar } from "../../../src/client/lib/myJarsApi";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("fetchMyJars", () => {
  it("returns the parsed payload on success", async () => {
    const payload = { ownedJars: [], starredJars: [] };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => payload });
    await expect(fetchMyJars()).resolves.toEqual(payload);
    // Cookies must be sent — better-auth identifies the user by session cookie.
    expect(fetchMock).toHaveBeenCalledWith("/api/jars/mine", { credentials: "include" });
  });

  it("throws on a non-OK response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(fetchMyJars()).rejects.toThrow(/failed to fetch jars/i);
  });
});

describe("deleteJar", () => {
  it("encodes the jar id into the URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await deleteJar("a/b c");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jars/a%2Fb%20c",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("treats 204 No Content as success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 204 });
    await expect(deleteJar("j1")).resolves.toBeUndefined();
  });

  it("surfaces the server's error message when present", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Not your jar" }),
    });
    await expect(deleteJar("j1")).rejects.toThrow("Not your jar");
  });

  it("falls back to a generic message when the body is unparseable", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(deleteJar("j1")).rejects.toThrow(/failed to delete jar/i);
  });
});

describe("starJar", () => {
  it("PUTs to the star endpoint", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await starJar("j1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jars/j1/star",
      expect.objectContaining({ method: "PUT", credentials: "include" }),
    );
  });

  it("treats 204 as success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 204 });
    await expect(starJar("j1")).resolves.toBeUndefined();
  });

  it("throws with server error message when starring fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "No such jar" }),
    });
    await expect(starJar("missing")).rejects.toThrow("No such jar");
  });
});

describe("unstarJar", () => {
  it("DELETEs the star endpoint", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await unstarJar("j1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jars/j1/star",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("treats 204 as success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 204 });
    await expect(unstarJar("j1")).resolves.toBeUndefined();
  });

  it("throws with server error message when unstarring fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });
    await expect(unstarJar("j1")).rejects.toThrow("boom");
  });
});
