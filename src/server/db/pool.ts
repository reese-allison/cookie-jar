import pg from "pg";

type PoolEnv = Record<string, string | undefined>;

function asPositiveInt(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function buildPoolConfig(env: PoolEnv = process.env): pg.PoolConfig {
  return {
    connectionString:
      env.DATABASE_URL ?? "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
    max: asPositiveInt(env.PG_POOL_MAX, 20),
    idleTimeoutMillis: asPositiveInt(env.PG_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: asPositiveInt(env.PG_CONNECTION_TIMEOUT_MS, 5_000),
    statement_timeout: asPositiveInt(env.PG_STATEMENT_TIMEOUT_MS, 10_000),
  };
}

const pool = new pg.Pool(buildPoolConfig());

export default pool;
