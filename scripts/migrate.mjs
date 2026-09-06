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
  const name = "001-invitations";
  const source = await readFile(new URL("../db/migrations/001-invitations.sql", import.meta.url), "utf8");
  const checksum = createHash("sha256").update(source).digest("hex");
  const rows = await sql.query("SELECT checksum FROM schema_migrations WHERE name = $1", [name]);
  if (rows.length) {
    if (rows[0].checksum !== checksum) throw new Error("La migración aplicada no coincide con el archivo; no se modificó la base.");
    console.log("La base ya está actualizada. No se modificaron invitados ni respuestas.");
  } else {
    const statements = source.split(";").map((statement) => statement.trim()).filter(Boolean);
    await sql.transaction([
      ...statements.map((statement) => sql.query(statement)),
      sql.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]),
    ]);
    console.log("Base preparada. No se han cargado invitados ni generado enlaces.");
  }
} catch {
  console.error("No se pudo preparar la base. Comprueba la conexión y el estado de las migraciones; las claves no se muestran aquí.");
  process.exitCode = 1;
}
