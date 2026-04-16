import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://cookie_jar:cookie_jar_dev@localhost:5432/cookie_jar",
});

export default pool;
