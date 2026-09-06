import "server-only";
import { neon } from "@neondatabase/serverless";

function databaseConnectionString(): string | undefined {
  // Preserve the exact prefix configured in this project's Neon integration.
  return process.env.DATABASE_URL?.trim() || process.env.DATABASE_WEEDING_DATABASE_URL?.trim();
}

export function databaseIsConfigured(): boolean {
  return Boolean(databaseConnectionString());
}

export async function queryDatabase<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  const connection = databaseConnectionString();
  if (!connection) throw new Error("La base de confirmaciones aún no está disponible.");
  // HTTP transport is compatible with Vercel functions; values are bound, never interpolated.
  const database = neon(connection);
  return (await database.query(sql, values)) as T[];
}
