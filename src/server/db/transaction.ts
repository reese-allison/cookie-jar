import type pg from "pg";

export type Queryable = pg.Pool | pg.PoolClient;

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let failure: unknown;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    failure = err;
    try {
      await client.query("ROLLBACK");
    } catch {
      // Swallow rollback errors — surface the original failure.
    }
    throw err;
  } finally {
    // Pass the error to release() on failure so node-postgres destroys the
    // client instead of returning a possibly-broken connection to the pool.
    // A connection aborted mid-statement can be in an unknown protocol state.
    if (failure !== undefined) {
      client.release(failure as Error);
    } else {
      client.release();
    }
  }
}
