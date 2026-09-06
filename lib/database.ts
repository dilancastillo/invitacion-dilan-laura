import "server-only";
import { neon } from "@neondatabase/serverless";

export function databaseIsConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function queryDatabase<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  const connection = process.env.DATABASE_URL?.trim();
  if (!connection) throw new Error("La base de confirmaciones aún no está disponible.");
  // HTTP transport is compatible with Vercel functions; values are bound, never interpolated.
  const database = neon(connection);
  return (await database.query(sql, values)) as T[];
}
