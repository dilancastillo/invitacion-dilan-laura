import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

// Exercise the private route and its real PostgreSQL statements with fictional guests only.
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

const migrations = ["001-invitations", "002-group-invitations", "003-admin-management"];
const fixtureOrigin = "https://invitation-tests.example";
let database, admin, rsvp, endpoint;
let session = { weddingAdmin: true, adminGithubId: "101" };
let sequence = 0;
before(async () => {
  database = new PGlite();
  for (const migration of migrations) {
    await database.exec(await readFile(new URL(`../db/migrations/${migration}.sql`, import.meta.url), "utf8"));
  }
  const databaseModule = {
    databaseIsConfigured: () => true,
    queryDatabase: async (sql, args) => (await database.query(sql, args)).rows,
  };
  const auth = { getAdminSession: async () => session };
  rsvp = await loadModule("lib/rsvp.ts", { "./database": databaseModule });
  admin = await loadModule("lib/admin.ts", {
    "./database": databaseModule, "./rsvp": rsvp, "./auth": auth,
  });
  const management = await loadModule("lib/admin-management.ts", { "./database": databaseModule });
  endpoint = await loadModule("app/api/admin/invitations/[id]/route.ts", {
    "../../../../../lib/auth": auth,
    "../../../../../lib/database": databaseModule,
    "../../../../../lib/origin": { isAllowedOrigin: (origin) => origin === fixtureOrigin },
    "../../../../../lib/admin-management": management,
  });
});
after(async () => { await database?.close(); });

async function fixtureGuest({ name = "Invitado ficticio", seats = 1, active = true, isTest = false } = {}) {
  const token = `fixture-admin-${String(++sequence).padStart(20, "0")}`;
  const result = await database.query(
    "INSERT INTO guests (display_name,token_hash,seat_count,active,is_test) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [name, await rsvp.sha256Hex(token), seats, active, isTest],
  );
  return { id: result.rows[0].id, token };
}
async function rowFor(id) { return (await admin.getAdminRows()).find(row => row.id === id); }
async function update(id, values = {}, headers = {}) {
  const row = await rowFor(id);
  const body = { decision: "attending", companions: [], expectedVersion: row?.version ?? "0".repeat(32), ...values };
  return endpoint.PATCH(new Request(`${fixtureOrigin}/api/admin/invitations/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", origin: fixtureOrigin, ...headers },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: String(id) }) });
}
async function rsvpFor(id) {
  return (await database.query("SELECT * FROM rsvps WHERE guest_id=$1", [id])).rows[0];
}

test("an authorized admin can record an offline confirmation after the public deadline", async (context) => {
  context.mock.method(Date, "now", () => Date.parse("2026-09-25T12:00:00Z"));
  const { id, token } = await fixtureGuest({ name: "María de prueba", seats: 2 });
  const response = await update(id);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const row = await rowFor(id);
  assert.equal(row.decision, "attending");
  assert.equal(row.responseSource, "admin");
  assert.deepEqual(admin.summarizeInvitations([row]), { invitations: 1, seats: 2, attending: 2, declined: 0, pending: 0 });
  assert.equal((await rsvp.getInviteByToken(token)).decision, "attending");
  assert.equal(await rsvp.saveResponse(id, "declined", "No debe reemplazar"), null);
  assert.equal((await database.query("SELECT count(*) FROM admin_invitation_changes WHERE guest_id=$1", [id])).rows[0].count, 1);
});

test("included companions and additional seats update counts exactly once and preserve the guest message", async () => {
  const { id, token } = await fixtureGuest({ seats: 2 });
  await database.query(
    "INSERT INTO rsvps(guest_id,decision,message,submitted_at,notification_status,notification_attempts) VALUES ($1,'attending',$2,'2026-09-10T12:00:00Z','sent',1)",
    [id, "Mi mensaje original 💙"],
  );
  const original = await rsvpFor(id);
  const companions = [
    { name: "José de prueba", additionalSeat: false },
    { name: "Ana de prueba", additionalSeat: true },
  ];
  assert.equal((await update(id, { companions })).status, 200);
  let row = await rowFor(id);
  assert.equal(row.seatCount, 3);
  assert.deepEqual(row.companions, companions);
  assert.equal(row.responseSource, "guest");
  assert.deepEqual((await rsvpFor(id)).submitted_at, original.submitted_at);
  assert.equal((await rsvp.getInviteByToken(token)).seatCount, 3);
  assert.deepEqual(admin.summarizeInvitations([row]), { invitations: 1, seats: 3, attending: 3, declined: 0, pending: 0 });
  assert.equal((await update(id, { companions })).status, 200);
  assert.equal((await rowFor(id)).seatCount, 3);
  assert.equal((await update(id, { decision: "declined", companions: companions.slice(0, 1) })).status, 200);
  row = await rowFor(id);
  assert.equal(row.seatCount, 2);
  assert.equal(row.responseSource, "admin");
  assert.deepEqual(admin.summarizeInvitations([row]), { invitations: 1, seats: 2, attending: 0, declined: 2, pending: 0 });
  const saved = await rsvpFor(id);
  for (const key of ["message", "notification_status", "notification_attempts"]) {
    assert.deepEqual(saved[key], original[key], `The original ${key} must survive a private edit`);
  }
  const changes = (await database.query("SELECT actor_id,before_state,after_state FROM admin_invitation_changes WHERE guest_id=$1 ORDER BY id", [id])).rows;
  assert.equal(changes.length, 2, "Saving unchanged data must not create a duplicate audit entry");
  assert.ok(changes.every(change => change.actor_id === "101"));
  assert.equal(changes[1].before_state.response.decision, "attending");
  assert.equal(changes[1].after_state.response.decision, "declined");
  assert.equal(changes[1].before_state.response.message, original.message);
});

test("simultaneous admin changes only accept one version and never duplicate extra seats", async () => {
  const { id } = await fixtureGuest();
  const { version } = await rowFor(id);
  const responses = await Promise.all([
    update(id, { expectedVersion: version, decision: "attending", companions: [{ name: "Acompañante ficticio", additionalSeat: true }] }),
    update(id, { expectedVersion: version, decision: "declined" }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const row = await rowFor(id);
  assert.notEqual(row.version, version);
  assert.equal(row.seatCount, row.decision === "attending" ? 2 : 1);
  assert.equal((await database.query("SELECT count(*) FROM admin_invitation_changes WHERE guest_id=$1", [id])).rows[0].count, 1);
});

test("a fresh guest response makes an older admin form stale without losing the response", async () => {
  const { id } = await fixtureGuest();
  const { version } = await rowFor(id);
  await database.query("INSERT INTO rsvps(guest_id,decision,message) VALUES ($1,'attending','Respuesta recién recibida')", [id]);
  assert.equal((await update(id, { expectedVersion: version, decision: "declined" })).status, 409);
  const saved = await rsvpFor(id);
  assert.equal(saved.decision, "attending");
  assert.equal(saved.message, "Respuesta recién recibida");
  assert.equal((await database.query("SELECT count(*) FROM admin_invitation_changes WHERE guest_id=$1", [id])).rows[0].count, 0);
});

test("pending companion records stay pending and an existing RSVP cannot be erased", async () => {
  const { id } = await fixtureGuest();
  const companions = [{ name: "Acompañante por confirmar", additionalSeat: true }];
  assert.equal((await update(id, { decision: null, companions })).status, 200);
  const pending = await rowFor(id);
  assert.equal(pending.decision, null);
  assert.equal(pending.seatCount, 2);
  assert.deepEqual(admin.summarizeInvitations([pending]), { invitations: 1, seats: 2, attending: 0, declined: 0, pending: 2 });
  assert.equal(await rsvpFor(id), undefined);
  assert.equal((await update(id, { companions })).status, 200);
  assert.equal((await update(id, { decision: null, companions: [] })).status, 400);
  assert.equal((await rowFor(id)).decision, "attending");
  assert.equal((await rowFor(id)).seatCount, 2);
});

test("invalid input, nonexistent invitations and non-real guests cannot be edited", async () => {
  const { id } = await fixtureGuest();
  const invalidUpdates = [
    { decision: "maybe" },
    { expectedVersion: "invalid" },
    { companions: "Ana" },
    { companions: [{ name: "", additionalSeat: true }] },
    { companions: [{ name: "A".repeat(121), additionalSeat: true }] },
    { companions: [{ name: "Ana", additionalSeat: "true" }] },
    { companions: [{ name: "Ana", additionalSeat: false }] },
    { companions: [{ name: "María", additionalSeat: true }, { name: " maria ", additionalSeat: true }] },
    { companions: Array.from({ length: 21 }, (_, index) => ({ name: `Acompañante ${index}`, additionalSeat: true })) },
  ];
  for (const values of invalidUpdates) {
    assert.equal((await update(id, values)).status, 400, JSON.stringify(values));
  }
  const inactive = await fixtureGuest({ active: false });
  const preview = await fixtureGuest({ isTest: true });
  for (const guestId of [inactive.id, preview.id, 2147483647]) {
    assert.equal((await update(guestId)).status, 404);
    assert.equal(await rsvpFor(guestId), undefined);
  }
  assert.equal((await rowFor(id)).decision, null);
  assert.equal((await rowFor(id)).seatCount, 1);
});

test("the private mutation requires both an authorized session and the correct origin", async () => {
  const { id } = await fixtureGuest();
  const validSession = session;
  try {
    session = null;
    assert.equal((await update(id)).status, 401);
    session = validSession;
    assert.equal((await update(id, {}, { origin: "https://another-site.example" })).status, 403);
    assert.equal((await update(id, {}, { origin: "" })).status, 403);
    assert.equal((await update(id, {}, { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await rowFor(id)).decision, null);
  } finally { session = validSession; }
});

test("malformed, oversized and invalid-identifier requests fail before writing any changes", async () => {
  const { id } = await fixtureGuest();
  async function raw(body, identifier = String(id)) {
    return endpoint.PATCH(new Request(`${fixtureOrigin}/api/admin/invitations/${identifier}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", origin: fixtureOrigin }, body,
    }), { params: Promise.resolve({ id: identifier }) });
  }
  assert.equal((await raw("{")).status, 400);
  assert.equal((await raw("null")).status, 400);
  assert.equal((await raw("[]")).status, 400);
  assert.equal((await raw("💙".repeat(5000))).status, 413);
  for (const identifier of ["0", "-1", "1.5", "2147483648", "1 OR 1=1"]) {
    assert.equal((await raw("{}", identifier)).status, 400);
  }
  assert.equal((await rowFor(id)).decision, null);
  assert.equal((await database.query("SELECT count(*) FROM admin_invitation_changes WHERE guest_id=$1", [id])).rows[0].count, 0);
});

test("the management migration preserves existing invitations, responses and notification history", async () => {
  const legacy = new PGlite();
  try {
    for (const migration of migrations.slice(0, 2)) {
      await legacy.exec(await readFile(new URL(`../db/migrations/${migration}.sql`, import.meta.url), "utf8"));
    }
    await legacy.query("INSERT INTO guests(display_name,token_hash,seat_count,source_key) VALUES ($1,$2,4,'fixture:legacy')", ["Familia anterior", "b".repeat(64)]);
    await legacy.exec("INSERT INTO rsvps(guest_id,decision,message,notification_status,notification_attempts) VALUES (1,'attending','Conservar mensaje','sent',2)");
    const beforeGuest = (await legacy.query("SELECT * FROM guests")).rows[0];
    const beforeRsvp = (await legacy.query("SELECT * FROM rsvps")).rows[0];
    await legacy.exec(await readFile(new URL("../db/migrations/003-admin-management.sql", import.meta.url), "utf8"));
    const afterGuest = (await legacy.query("SELECT * FROM guests")).rows[0];
    const afterRsvp = (await legacy.query("SELECT * FROM rsvps")).rows[0];
    for (const key of Object.keys(beforeGuest)) assert.deepEqual(afterGuest[key], beforeGuest[key]);
    for (const key of Object.keys(beforeRsvp)) assert.deepEqual(afterRsvp[key], beforeRsvp[key]);
    assert.deepEqual(afterGuest.companions, []);
    assert.equal(afterGuest.admin_revision, 0);
    assert.equal(afterRsvp.response_source, "guest");
    assert.equal((await legacy.query("SELECT count(*) FROM admin_invitation_changes")).rows[0].count, 0);
  } finally { await legacy.close(); }
});
