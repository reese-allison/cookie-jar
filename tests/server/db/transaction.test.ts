import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPoolConfig } from "../../../src/server/db/pool";
import * as jarQueries from "../../../src/server/db/queries/jars";
import * as userQueries from "../../../src/server/db/queries/users";
import { withTransaction } from "../../../src/server/db/transaction";

let pool: pg.Pool;
let ownerId: string;

beforeAll(async () => {
  pool = new pg.Pool(buildPoolConfig());
  const user = await userQueries.createUser(pool, {
    displayName: "Tx Test User",
    email: "tx-test@example.com",
  });
  ownerId = user.id;
});

afterAll(async () => {
  await pool.query("DELETE FROM jars WHERE owner_id = $1", [ownerId]);
  await pool.query("DELETE FROM users WHERE id = $1", [ownerId]);
  await pool.end();
});

beforeEach(async () => {
  await pool.query("DELETE FROM jars WHERE owner_id = $1", [ownerId]);
});

describe("withTransaction", () => {
  it("commits on success", async () => {
    const jar = await withTransaction(pool, async (client) => {
      return jarQueries.createJar(client, {
        ownerId,
        name: "committed jar",
      });
    });
    const found = await jarQueries.getJarById(pool, jar.id);
    expect(found?.name).toBe("committed jar");
  });

  it("rolls back when the callback throws", async () => {
    let createdId: string | undefined;
    await expect(
      withTransaction(pool, async (client) => {
        const jar = await jarQueries.createJar(client, {
          ownerId,
          name: "rolled back jar",
        });
        createdId = jar.id;
        throw new Error("planned failure");
      }),
    ).rejects.toThrow("planned failure");

    expect(createdId).toBeDefined();
    const found = await jarQueries.getJarById(pool, createdId as string);
    expect(found).toBeNull();
  });

  it("rolls back when a later query fails inside the transaction", async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await jarQueries.createJar(client, { ownerId, name: "partial" });
        await client.query("INSERT INTO jars (id) VALUES ('not-a-uuid')");
      }),
    ).rejects.toThrow();

    const jars = await jarQueries.listJarsByOwner(pool, ownerId);
    expect(jars).toHaveLength(0);
  });
});
