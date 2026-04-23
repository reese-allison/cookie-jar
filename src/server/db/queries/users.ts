import type { User } from "@shared/types";
import type pg from "pg";

interface CreateUserInput {
  displayName: string;
  email: string;
  image?: string;
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    image: (row.image as string) ?? undefined,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function createUser(pool: pg.Pool, input: CreateUserInput): Promise<User> {
  const { rows } = await pool.query(
    `INSERT INTO users (display_name, email, image)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.displayName, input.email, input.image ?? null],
  );
  return rowToUser(rows[0]);
}
