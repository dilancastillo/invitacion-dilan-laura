import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

// Run the actual application queries against PostgreSQL in WASM, with no external account or real guests.
async function loadModule(path, imports) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "server-only") return {};
    if (name in imports) return imports[name];
    throw new Error(`Unexpected test import: ${name}`);
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

let database, rsvp, admin, endpoint;
const jobs = [];
const notifications = [];
const queries = [];
const fixtureOrigin = "https://invitation-tests.example";
before(async () => {
  database = new PGlite();
  const schema = await readFile(new URL("../db/migrations/001-invitations.sql", import.meta.url), "utf8");
  await database.exec(schema);
  await database.exec(await readFile(new URL("../db/migrations/002-group-invitations.sql", import.meta.url), "utf8"));
  const databaseModule = {
    databaseIsConfigured: () => true,
    queryDatabase: async (sql, args) => {
      queries.push({ sql, args });
      return (await database.query(sql, args)).rows;
    },
  };
  rsvp = await loadModule("lib/rsvp.ts", { "./database": databaseModule });
  admin = await loadModule("lib/admin.ts", {
    "./database": databaseModule, "./rsvp": rsvp,
    "./auth": { getAdminSession: async () => null },
  });
  endpoint = await loadModule("app/api/rsvp/route.ts", {
    "../../../lib/rsvp": { ...rsvp, notifyRsvp: async (...args) => {
      notifications.push(args);
      return "pending";
    } },
    "../../../lib/database": databaseModule,
    "../../../lib/origin": { isAllowedOrigin: (origin) => origin === fixtureOrigin },
    "next/server": { after: (job) => jobs.push(job) },
  });
});
after(async () => { await database?.close(); });

async function fixtureGuest(token, name = "Invitado de prueba", active = true, seatCount = 1, isTest = false) {
  const rows = await database.query("INSERT INTO guests (display_name, token_hash, active, seat_count, is_test) VALUES ($1,$2,$3,$4,$5) RETURNING id", [
    name, await rsvp.sha256Hex(token), active, seatCount, isTest,
  ]);
  return rows.rows[0].id;
}
function request(token, decision = "attending", message = "") {
  return new Request(`${fixtureOrigin}/api/rsvp`, {
    method: "POST", headers: { "Content-Type": "application/json", origin: fixtureOrigin },
    body: JSON.stringify({ token, decision, message }),
  });
}

test("PostgreSQL keeps the token hashed and round-trips names with accents", async () => {
  const token = "f".repeat(32);
  await fixtureGuest(token, "María & José");
  const record = await rsvp.getInviteByToken(token);
  assert.equal(record.displayName, "María & José");
  assert.equal(record.decision, null);
  assert.equal(await rsvp.getInviteByToken("invalid' OR 1=1"), null);
  const stored = (await database.query("SELECT token_hash FROM guests WHERE id = $1", [record.id])).rows[0];
  assert.equal(stored.token_hash.length, 64);
  assert.notEqual(stored.token_hash, token);
});

test("simultaneous RSVP submissions only save one decision and schedule one notification", async (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-09-10T12:00:00Z"));
  const token = "c".repeat(32);
  const id = await fixtureGuest(token);
  const originalJobs = jobs.length;
  const responses = await Promise.all([
    endpoint.POST(request(token, "attending", "Nos vemos")),
    endpoint.POST(request(token, "declined", "Otro mensaje")),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const success = await responses.find((response) => response.status === 201).json();
  assert.ok(success.response.submittedAt.endsWith("Z"));
  const saved = (await database.query("SELECT decision, message FROM rsvps WHERE guest_id = $1", [id])).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].decision, success.response.decision);
  assert.equal(jobs.length - originalJobs, 1);
  const previousNotifications = notifications.length;
  await jobs[originalJobs]();
  assert.equal(notifications.length - previousNotifications, 1);
  assert.deepEqual(notifications.at(-1), [id, "Invitado de prueba", saved[0].decision, saved[0].message, 1]);
  assert.equal((await endpoint.POST(request(token, "declined", "No debe reemplazar"))).status, 409);
  assert.equal((await rsvp.getInviteByToken(token)).message, saved[0].message);
});

test("the actual INSERT also enforces the deadline inside PostgreSQL", async () => {
  const id = await fixtureGuest("g".repeat(32));
  const insert = queries.find(({ sql }) => sql.includes("INSERT INTO rsvps"));
  assert.ok(insert);
  assert.equal(insert.args[3], new Date(rsvp.RSVP_DEADLINE_UTC).toISOString());
  // Exercise the unchanged application SQL with an expired bind parameter, bypassing the HTTP precheck.
  const result = await database.query(insert.sql, [id, "attending", "", "2000-01-01T00:00:00Z"]);
  assert.equal(result.rows.length, 0);
  assert.equal((await database.query("SELECT * FROM rsvps WHERE guest_id = $1", [id])).rows.length, 0);
});

test("inactive guests, invalid input and deadline are enforced", async (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-09-10T12:00:00Z"));
  const token = "d".repeat(32);
  const id = await fixtureGuest(token, "Invitado inactivo", false);
  assert.equal((await endpoint.POST(request(token))).status, 404);
  assert.equal(await rsvp.saveResponse(id, "attending", ""), null);
  assert.equal((await endpoint.POST(request("e".repeat(32), "invalid"))).status, 400);
  assert.equal((await endpoint.POST(request("e".repeat(32), "attending", "a".repeat(501)))).status, 400);
  Date.now.mock.mockImplementation(() => Date.parse("2026-09-21T05:00:00Z"));
  assert.equal((await endpoint.POST(request("e".repeat(32)))).status, 410);
});

test("admin queries and CSV escaping preserve names but never execute spreadsheet formulas", async () => {
  const rows = await admin.getAdminRows();
  assert.ok(rows.some((row) => row.displayName === "María & José"));
  assert.ok(rows.every((row) => row.displayName !== "Invitado inactivo"));
  assert.equal(admin.csvCell(" =1+1"), '"\' =1+1"');
  assert.equal(admin.csvCell("\t@SUM(A1)"), '"\'\t@SUM(A1)"');
  assert.equal(admin.csvCell('María "Luz"'), '"María ""Luz"""');
  assert.equal((await admin.requireAdminApi()).response.status, 401);
});

test("one group response confirms all four server-owned seats and ignores forged counts", async (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-09-10T12:00:00Z"));
  const token = "h".repeat(32);
  await fixtureGuest(token, "Familia de cuatro", true, 4);
  const invite = await rsvp.getInviteByToken(token);
  assert.equal(invite.seatCount, 4);
  assert.equal(invite.isTest, false);
  const response = await endpoint.POST(new Request(`${fixtureOrigin}/api/rsvp`, {
    method: "POST", headers: { "Content-Type": "application/json", origin: fixtureOrigin },
    body: JSON.stringify({ token, decision: "attending", seatCount: 1, isTest: true }),
  }));
  assert.equal(response.status, 201);
  const row = (await admin.getAdminRows()).find(row => row.id === invite.id);
  assert.deepEqual(admin.summarizeInvitations([row]), { invitations: 1, seats: 4, attending: 4, declined: 0, pending: 0 });
  assert.deepEqual(admin.summarizeInvitations([{...row, decision: "declined"}]), { invitations: 1, seats: 4, attending: 0, declined: 4, pending: 0 });
  assert.deepEqual(admin.summarizeInvitations([{...row, decision: null}]), { invitations: 1, seats: 4, attending: 0, declined: 0, pending: 4 });
  await jobs.at(-1)();
  assert.equal(notifications.at(-1).at(-1), 4);
});

test("test invitations are view-only and excluded from real rows, counts and email", async (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-09-10T12:00:00Z"));
  const summaryBefore = admin.summarizeInvitations(await admin.getAdminRows());
  const token = "i".repeat(32);
  const id = await fixtureGuest(token, "Vista previa de pareja", true, 2, true);
  assert.equal((await rsvp.getInviteByToken(token)).isTest, true);
  const jobsBefore = jobs.length;
  assert.equal((await endpoint.POST(request(token))).status, 403);
  assert.equal(await rsvp.saveResponse(id, "attending", "No debe guardarse"), null);
  const forged = new Request(`${fixtureOrigin}/api/rsvp`, {
    method: "POST", headers: { "Content-Type": "application/json", origin: fixtureOrigin },
    body: JSON.stringify({ token, decision: "attending", isTest: false }),
  });
  assert.equal((await endpoint.POST(forged)).status, 403);
  assert.equal(jobs.length, jobsBefore);
  const rows = await admin.getAdminRows();
  assert.ok(!rows.some(row => row.id === id));
  assert.deepEqual(admin.summarizeInvitations(rows), summaryBefore);
  assert.equal((await database.query("SELECT count(*) FROM rsvps WHERE guest_id=$1", [id])).rows[0].count, 0);
});

test("the additive group migration preserves existing records and validates seats", async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(await readFile(new URL("../db/migrations/001-invitations.sql", import.meta.url), "utf8"));
    await legacy.query("INSERT INTO guests(display_name,token_hash) VALUES ($1,$2)", ["Anterior", "b".repeat(64)]);
    await legacy.exec("INSERT INTO rsvps(guest_id,decision,message) VALUES (1,'attending','Conservar')");
    await legacy.exec(await readFile(new URL("../db/migrations/002-group-invitations.sql", import.meta.url), "utf8"));
    const record = (await legacy.query("SELECT display_name, seat_count, is_test, source_key FROM guests")).rows[0];
    assert.deepEqual(record, {display_name: "Anterior", seat_count: 1, is_test: false, source_key: null});
    assert.equal((await legacy.query("SELECT message FROM rsvps")).rows[0].message, "Conservar");
    await assert.rejects(legacy.exec("UPDATE guests SET seat_count=0"));
    await assert.rejects(legacy.exec("UPDATE guests SET seat_count=-1"));
    await assert.rejects(legacy.exec("UPDATE guests SET seat_count=NULL"));
  } finally { await legacy.close(); }
});
