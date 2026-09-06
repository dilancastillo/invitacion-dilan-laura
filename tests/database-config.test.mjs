import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Isolate the real module from process.env and replace Neon: these tests cannot reach a real database.
async function fixture(environment) {
  const source = await readFile(new URL("../lib/database.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const compiledModule = { exports: {} };
  const connections = [];
  const queries = [];
  new Function("require", "module", "exports", "process", compiled)((name) => {
    if (name === "server-only") return {};
    if (name === "@neondatabase/serverless") return { neon: (connection) => {
      connections.push(connection);
      return { query: async (sql, values) => { queries.push({ sql, values }); return [{ ok: true }]; } };
    } };
    throw new Error(`Unexpected import: ${name}`);
  }, compiledModule, compiledModule.exports, { env: environment });
  return { ...compiledModule.exports, connections, queries };
}

test("database configuration fails closed when both supported variables are absent", async () => {
  const database = await fixture({ DATABASE_URL: " ", DATABASE_WEEDING_DATABASE_URL: " " });
  assert.equal(database.databaseIsConfigured(), false);
  await assert.rejects(database.queryDatabase("SELECT 1"), /La base de confirmaciones aún no está disponible/);
  assert.equal(database.connections.length, 0);
});

test("database runtime accepts the exact WEEDING-prefixed Neon connection", async () => {
  const database = await fixture({ DATABASE_WEEDING_DATABASE_URL: "  postgres://fixture.invalid/wedding  " });
  assert.equal(database.databaseIsConfigured(), true);
  assert.deepEqual(await database.queryDatabase("SELECT $1", ["test"]), [{ ok: true }]);
  assert.deepEqual(database.connections, ["postgres://fixture.invalid/wedding"]);
  assert.deepEqual(database.queries, [{ sql: "SELECT $1", values: ["test"] }]);
});

test("canonical DATABASE_URL takes precedence, including after trimming", async () => {
  const database = await fixture({
    DATABASE_URL: " postgres://fixture.invalid/canonical ",
    DATABASE_WEEDING_DATABASE_URL: "postgres://fixture.invalid/secondary",
  });
  await database.queryDatabase("SELECT 1");
  assert.deepEqual(database.connections, ["postgres://fixture.invalid/canonical"]);
  const canonicalOnly = await fixture({ DATABASE_URL: "postgres://fixture.invalid/canonical" });
  assert.equal(canonicalOnly.databaseIsConfigured(), true);
});

test("empty canonical value uses the prefix; unrelated or public variables are never accepted", async () => {
  const database = await fixture({ DATABASE_URL: " ", DATABASE_WEEDING_DATABASE_URL: "postgres://fixture.invalid/wedding" });
  assert.equal(database.databaseIsConfigured(), true);
  const unrelated = await fixture({
    DATABASE_WEDDING_DATABASE_URL: "postgres://fixture.invalid/wrong-spelling",
    NEXT_PUBLIC_DATABASE_URL: "postgres://fixture.invalid/public",
    DATABASE_WEEDING_PGPASSWORD: "not-a-connection",
  });
  assert.equal(unrelated.databaseIsConfigured(), false);
});

test("migration and runtime resolve the same names with the same precedence", async () => {
  const migration = await readFile(new URL("../scripts/migrate.mjs", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../lib/database.ts", import.meta.url), "utf8");
  const resolver = "process.env.DATABASE_URL?.trim() || process.env.DATABASE_WEEDING_DATABASE_URL?.trim()";
  assert.ok(migration.includes(resolver));
  assert.ok(runtime.includes(resolver));
  assert.match(migration, /neon\(connection\)/);
});

test("local HTTP tests explicitly clear both possible production connections", async () => {
  const source = await readFile(new URL("support/server.mjs", import.meta.url), "utf8");
  assert.match(source, /DATABASE_URL:\s*""/);
  assert.match(source, /DATABASE_WEEDING_DATABASE_URL:\s*""/);
});
