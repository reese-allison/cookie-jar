/**
 * Lives in its own file because we vi.mock @shared/validation to inject a
 * deterministic generateRoomCode — that mock applies to the whole module
 * graph for this file and would interfere with other jar tests that rely
 * on the real generator.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted to the top of the file before any imports or var
// declarations. Use vi.hoisted to lift the mock-controller var alongside
// it so the factory can capture it.
const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }));

vi.mock("@shared/validation", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, generateRoomCode: generateMock };
});

// Hard-coded 7-char codes from ROOM_CODE_CHARS (no I/O/0/1). Any valid pair
// works — we just need known values to drive the mocked generator.
const COLLIDING_CODE = "ABCDEFG";
const SURVIVOR_CODE = "JKLMNPQ";

// Import AFTER the mock is registered so jarQueries picks up the mocked
// generator.
const { createJar } = await import("../../../src/server/db/queries/jars");
const userQueries = await import("../../../src/server/db/queries/users");

let pool: pg.Pool;
let testUserId: string;

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });
  const user = await userQueries.createUser(pool, {
    displayName: "Retry Test User",
    email: "retry-test@example.com",
  });
  testUserId = user.id;
});

beforeEach(async () => {
  generateMock.mockReset();
  await pool.query("DELETE FROM jars WHERE owner_id = $1", [testUserId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM jars WHERE owner_id = $1", [testUserId]);
  await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  await pool.end();
});

describe("createJar share_code collision retry", () => {
  it("regenerates a fresh share_code when the generator hits an existing value", async () => {
    // Regression guard: the loop must call generateRoomCode EACH iteration
    // (inside the catch), not once outside. If a refactor moved the call
    // out, the same colliding code would be retried 5x and the loop would
    // throw — observable here.
    generateMock.mockReturnValueOnce(COLLIDING_CODE);
    const firstJar = await createJar(pool, { ownerId: testUserId, name: "First" });
    expect(firstJar.shareCode).toBe(COLLIDING_CODE);

    // Drive the retry: generator returns the same code first (collides),
    // then a unique one (succeeds).
    generateMock.mockReset();
    generateMock.mockReturnValueOnce(COLLIDING_CODE).mockReturnValueOnce(SURVIVOR_CODE);

    const secondJar = await createJar(pool, { ownerId: testUserId, name: "Second" });
    expect(secondJar.shareCode).toBe(SURVIVOR_CODE);
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it("eventually throws after exhausting the retry budget", async () => {
    // If the generator NEVER produces a unique code (universe of pathological
    // tests), createJar must throw a clear "exhausted retries" error so the
    // caller can surface it — not loop forever or silently insert.
    generateMock.mockReturnValueOnce(COLLIDING_CODE);
    await createJar(pool, { ownerId: testUserId, name: "Occupier" });

    generateMock.mockReset();
    // Always return the colliding code — every attempt trips the unique
    // constraint.
    generateMock.mockReturnValue(COLLIDING_CODE);
    await expect(createJar(pool, { ownerId: testUserId, name: "Doomed" })).rejects.toThrow(
      /collision retries|duplicate key/i,
    );
  });
});
