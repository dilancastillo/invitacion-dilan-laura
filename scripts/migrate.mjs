import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

// Match the runtime's precedence, including the exact Neon prefix chosen in Vercel.
const connection = process.env.DATABASE_URL?.trim() || process.env.DATABASE_WEEDING_DATABASE_URL?.trim();
if (!connection) {
  console.error("Falta DATABASE_URL o DATABASE_WEEDING_DATABASE_URL. Configúrala en .env.local o en el entorno privado.");
  process.exit(1);
}

try {
  const sql = neon(connection);
  await sql.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const migrations = await Promise.all(["001-invitations", "002-group-invitations", "003-admin-management"].map(async (name) => {
    const source = await readFile(new URL(`../db/migrations/${name}.sql`, import.meta.url), "utf8");
    return { name, source, checksum: createHash("sha256").update(source).digest("hex") };
  }));
  // Check every already-applied migration before making new changes.
  const applied = new Map((await sql.query("SELECT name, checksum FROM schema_migrations")).map(row => [row.name, row.checksum]));
  for (const { name, checksum } of migrations) {
    if (applied.has(name) && applied.get(name) !== checksum) {
      throw new Error("Una migración aplicada no coincide con el archivo.");
    }
  }
  for (const { name, source, checksum } of migrations) {
    if (applied.has(name)) continue;
    const separator = source.includes("-- statement-breakpoint") ? "-- statement-breakpoint" : ";";
    const statements = source.split(separator).map((statement) => statement.trim()).filter(Boolean);
    await sql.transaction([
      ...statements.map((statement) => sql.query(statement)),
      sql.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]),
    ]);
  }
  console.log("Base preparada. No se han cargado invitados ni generado enlaces.");
} catch {
  console.error("No se pudo preparar la base. Comprueba la conexión y el estado de las migraciones; las claves no se muestran aquí.");
  process.exitCode = 1;
}
