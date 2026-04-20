import type { Note } from "@shared/types";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSealedNotesStore } from "../../../src/server/socket/sealedNotesStore";

let redis: Redis;

function makeNote(text: string): Note {
  return {
    id: `note-${text}`,
    jarId: "jar-test",
    text,
    style: "sticky",
    state: "pulled",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
});

afterAll(async () => {
  await redis.quit();
});

afterEach(async () => {
  // Clean up any keys left by individual tests.
  const keys = await redis.keys("room:test-*:sealed");
  if (keys.length > 0) await redis.del(...keys);
});

describe("sealedNotesStore (Redis)", () => {
  it("push returns the incremented length", async () => {
    const store = createSealedNotesStore(redis);
    expect(await store.push("test-1", makeNote("A"))).toBe(1);
    expect(await store.push("test-1", makeNote("B"))).toBe(2);
    expect(await store.push("test-1", makeNote("C"))).toBe(3);
  });

  it("push isolates rooms", async () => {
    const store = createSealedNotesStore(redis);
    expect(await store.push("test-2a", makeNote("A"))).toBe(1);
    expect(await store.push("test-2b", makeNote("A"))).toBe(1);
    expect(await store.push("test-2a", makeNote("B"))).toBe(2);
  });

  it("revealIfReady returns [] until threshold is reached", async () => {
    const store = createSealedNotesStore(redis);
    await store.push("test-3", makeNote("A"));
    expect(await store.revealIfReady("test-3", 3)).toEqual([]);
    await store.push("test-3", makeNote("B"));
    expect(await store.revealIfReady("test-3", 3)).toEqual([]);
  });

  it("revealIfReady drains + returns the buffer once threshold is reached", async () => {
    const store = createSealedNotesStore(redis);
    await store.push("test-4", makeNote("A"));
    await store.push("test-4", makeNote("B"));
    const revealed = await store.revealIfReady("test-4", 2);
    expect(revealed).toHaveLength(2);
    expect(revealed[0].text).toBe("A");
    expect(revealed[1].text).toBe("B");
    // Second call sees an empty buffer.
    expect(await store.revealIfReady("test-4", 1)).toEqual([]);
  });

  it("revealIfReady is atomic — only one caller wins a concurrent reveal", async () => {
    const store = createSealedNotesStore(redis);
    await store.push("test-5", makeNote("A"));
    await store.push("test-5", makeNote("B"));
    const [a, b] = await Promise.all([
      store.revealIfReady("test-5", 2),
      store.revealIfReady("test-5", 2),
    ]);
    // Exactly one got the notes, the other got []
    const winners = [a, b].filter((r) => r.length > 0);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toHaveLength(2);
  });

  it("clear drops the buffer unconditionally", async () => {
    const store = createSealedNotesStore(redis);
    await store.push("test-6", makeNote("A"));
    await store.clear("test-6");
    expect(await store.revealIfReady("test-6", 1)).toEqual([]);
  });
});
