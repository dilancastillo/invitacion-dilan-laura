import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { encode } from "next-auth/jwt";
import { startTestServer } from "./support/server.mjs";

// Deliberately fictional credentials: these tests never contact GitHub or Neon.
const testSecret = "test-only-not-a-real-secret-".repeat(3);
let server;
before(async () => { server = await startTestServer({
  NEXTAUTH_SECRET: testSecret, GITHUB_ID: "test-client-id", GITHUB_SECRET: "test-client-secret",
  ADMIN_GITHUB_IDS: "101",
}); });
after(async () => { await server?.stop(); });

test("configured auth refuses forged identity headers and unsigned cookies", async () => {
  const response = await fetch(`${server.origin}/api/admin/rsvps.csv`, { headers: {
    "oai-authenticated-user-id": "101", "oai-authenticated-user-email": "admin@example.com",
    cookie: "next-auth.session-token=forged-token",
  } });
  assert.equal(response.status, 401);
  assert.equal((await fetch(`${server.origin}/admin`, { redirect: "manual" })).status, 307);
});

test("GitHub ID allowlist is revalidated even with a correctly signed session", async () => {
  const rejected = await encode({ secret: testSecret, token: { githubId: "202", name: "Not authorized" } });
  assert.equal((await fetch(`${server.origin}/api/admin/rsvps.csv`, {
    headers: { cookie: `next-auth.session-token=${rejected}` },
  })).status, 401);
  const allowed = await encode({ secret: testSecret, token: { githubId: "101", name: "Test admin" } });
  const adminPage = await fetch(`${server.origin}/admin`, {
    headers: { cookie: `next-auth.session-token=${allowed}` }, redirect: "manual",
  });
  assert.equal(adminPage.status, 200);
  assert.match(await adminPage.text(), /Falta conectar la base de confirmaciones/);
});

test("sign-in serves CSRF protection without exposing client secrets", async () => {
  const response = await fetch(`${server.origin}/api/auth/csrf`);
  assert.equal(response.status, 200);
  assert.equal(typeof (await response.json()).csrfToken, "string");
  const providers = await (await fetch(`${server.origin}/api/auth/providers`)).text();
  assert.doesNotMatch(providers, /test-client-secret|test-only-not-a-real-secret/);
});

test("manual confirmation edits reject forged identities and unauthorized signed sessions", async () => {
  const body = JSON.stringify({ decision: "attending", companions: [], expectedVersion: "0".repeat(32) });
  async function submit(cookie, origin = server.origin) {
    return fetch(`${server.origin}/api/admin/invitations/1`, {
      method: "PATCH", headers: {
        "Content-Type": "application/json", origin, cookie,
        "oai-authenticated-user-id": "101", "oai-authenticated-user-email": "admin@example.com",
      }, body,
    });
  }
  const forged = await submit("next-auth.session-token=forged-token");
  assert.equal(forged.status, 401);
  assert.match(forged.headers.get("cache-control"), /no-store/);
  const rejected = await encode({ secret: testSecret, token: { githubId: "202", name: "Not authorized" } });
  assert.equal((await submit(`next-auth.session-token=${rejected}`)).status, 401);
  const allowed = await encode({ secret: testSecret, token: { githubId: "101", name: "Test admin" } });
  assert.equal((await submit(`next-auth.session-token=${allowed}`, "https://another-site.example")).status, 403);
  assert.equal((await submit(`next-auth.session-token=${allowed}`, "")).status, 403);
  assert.equal((await submit(`next-auth.session-token=${allowed}`)).status, 503);
});
