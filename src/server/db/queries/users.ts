import type { User } from "@shared/types";
import type pg from "pg";

interface CreateUserInput {
  displayName: string;
  email?: string;
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: (row.email as string) ?? undefined,
    displayName: row.display_name as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function createUser(pool: pg.Pool, input: CreateUserInput): Promise<User> {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, email)
     VALUES ($1, $2)
     RETURNING *`,
    [input.displayName, input.email ?? null],
  );
  return rowToUser(rows[0]);
}

export async function getUserById(pool: pg.Pool, id: string): Promise<User | null> {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows.length > 0 ? rowToUser(rows[0]) : null;
}
