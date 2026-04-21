import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as userQueries from "../../../src/server/db/queries/users";
import { makeJarAppearance, makeJarConfig } from "../../helpers/fixtures";

let pool: pg.Pool;
let testUserId: string;

const TEST_APPEARANCE = makeJarAppearance();
const TEST_CONFIG = makeJarConfig();

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
  });
  // Create a test user for foreign key constraints
  const user = await userQueries.createUser(pool, {
    displayName: "Test User",
    email: "test-jars@example.com",
  });
  testUserId = user.id;
});

beforeEach(async () => {
  // Clean up jars before each test (but keep the test user)
  await pool.query("DELETE FROM jars WHERE owner_id = $1", [testUserId]);
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  await pool.end();
});

describe("jar queries", () => {
  it("creates a jar and returns it with all fields", async () => {
    const jar = await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "My Test Jar",
      appearance: TEST_APPEARANCE,
      config: TEST_CONFIG,
    });

    expect(jar.id).toBeDefined();
    expect(jar.ownerId).toBe(testUserId);
    expect(jar.name).toBe("My Test Jar");
    expect(jar.appearance).toEqual(TEST_APPEARANCE);
    expect(jar.config).toEqual(TEST_CONFIG);
    expect(jar.createdAt).toBeDefined();
    expect(jar.updatedAt).toBeDefined();
  });

  it("gets a jar by id", async () => {
    const created = await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "Findable Jar",
      appearance: TEST_APPEARANCE,
      config: TEST_CONFIG,
    });

    const found = await jarQueries.getJarById(pool, created.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("Findable Jar");
  });

  it("returns null for a non-existent jar", async () => {
    const found = await jarQueries.getJarById(pool, "00000000-0000-0000-0000-000000000000");
    expect(found).toBeNull();
  });

  it("lists jars by owner", async () => {
    await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "Jar A",
      appearance: TEST_APPEARANCE,
      config: TEST_CONFIG,
    });
    await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "Jar B",
      appearance: TEST_APPEARANCE,
      config: TEST_CONFIG,
    });

    // Default call hides private jars (enumeration guard); includePrivate is
    // how the owner's own listing gets everything.
    const publicOnly = await jarQueries.listJarsByOwner(pool, testUserId);
    expect(publicOnly).toHaveLength(0);

    const mine = await jarQueries.listJarsByOwner(pool, testUserId, { includePrivate: true });
    expect(mine).toHaveLength(2);
    expect(mine.map((j) => j.name).sort()).toEqual(["Jar A", "Jar B"]);
  });

  it("updates a jar name", async () => {
    const jar = await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "Old Name",
      appearance: TEST_APPEARANCE,
      config: TEST_CONFIG,
    });

    const updated = await jarQueries.updateJar(pool, jar.id, { name: "New Name" });
    expect(updated?.name).toBe("New Name");
    expect(updated?.updatedAt).not.toBe(jar.updatedAt);
  });

  it("deletes a jar", async () => {
    const jar = await jarQueries.createJar(pool, {
      ownerId: testUserId,
      name: "Doomed Jar",
      appearance: TEST_APPEARANCE,
      config: TEST_CONFIG,
    });

    const deleted = await jarQueries.deleteJar(pool, jar.id);
    expect(deleted).toBe(true);

    const found = await jarQueries.getJarById(pool, jar.id);
    expect(found).toBeNull();
  });

  it("returns false when deleting a non-existent jar", async () => {
    const deleted = await jarQueries.deleteJar(pool, "00000000-0000-0000-0000-000000000000");
    expect(deleted).toBe(false);
  });
});
