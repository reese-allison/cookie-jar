import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSealedNotesStore } from "../../../src/server/socket/sealedNotesStore";
import type { Note } from "../../../src/shared/types";

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

  it("remove drops a specific note without disturbing the rest", async () => {
    const store = createSealedNotesStore(redis);
    await store.push("test-7", makeNote("A"));
    await store.push("test-7", makeNote("B"));
    await store.push("test-7", makeNote("C"));
    await store.remove("test-7", "note-B");
    const revealed = await store.revealIfReady("test-7", 2);
    expect(revealed.map((n) => n.text)).toEqual(["A", "C"]);
  });

  it("remove is a silent no-op when the note isn't buffered", async () => {
    const store = createSealedNotesStore(redis);
    await store.push("test-8", makeNote("A"));
    await store.remove("test-8", "note-ghost");
    expect(await store.length("test-8")).toBe(1);
  });

  it("updateInBuffer replaces the buffered snapshot in place", async () => {
    const store = createSealedNotesStore(redis);
    await store.push("test-9", makeNote("old-1"));
    await store.push("test-9", makeNote("old-2"));
    // Overwrite the text of the second buffered note with a fresh snapshot.
    const edited: Note = { ...makeNote("new-2"), id: "note-old-2" };
    await store.updateInBuffer("test-9", edited);
    const revealed = await store.revealIfReady("test-9", 2);
    expect(revealed.map((n) => n.text)).toEqual(["old-1", "new-2"]);
  });

  it("updateInBuffer preserves queue order — threshold still fires at the same count", async () => {
    const store = createSealedNotesStore(redis);
    await store.push("test-10", makeNote("A"));
    await store.push("test-10", makeNote("B"));
    await store.updateInBuffer("test-10", { ...makeNote("A-edited"), id: "note-A" });
    // Still 2 in the buffer, reveals at threshold 2.
    expect(await store.length("test-10")).toBe(2);
    const revealed = await store.revealIfReady("test-10", 2);
    expect(revealed).toHaveLength(2);
    expect(revealed[0].text).toBe("A-edited");
  });

  it("updateInBuffer is a silent no-op when the note isn't buffered", async () => {
    const store = createSealedNotesStore(redis);
    await store.push("test-11", makeNote("A"));
    await store.updateInBuffer("test-11", { ...makeNote("ghost"), id: "note-ghost" });
    expect(await store.length("test-11")).toBe(1);
  });

  it("revealIfReady skips malformed entries instead of throwing", async () => {
    const store = createSealedNotesStore(redis);
    // Seed the Redis list directly with a valid blob followed by garbage.
    // A JSON.parse crash inside the reveal would wedge the sealed workflow
    // for the whole room; we want the good entry through and the bad one dropped.
    const k = "room:test-12:sealed";
    await redis.rpush(
      k,
      JSON.stringify(makeNote("A")),
      "{not valid json",
      JSON.stringify(makeNote("B")),
    );
    const revealed = await store.revealIfReady("test-12", 3);
    expect(revealed.map((n) => n.text)).toEqual(["A", "B"]);
  });

  it("drain skips malformed entries instead of throwing", async () => {
    const store = createSealedNotesStore(redis);
    const k = "room:test-13:sealed";
    await redis.rpush(k, "{broken", JSON.stringify(makeNote("B")));
    const drained = await store.drain("test-13");
    expect(drained.map((n) => n.text)).toEqual(["B"]);
  });
});
