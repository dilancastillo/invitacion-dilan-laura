import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import { startTestServer } from "./support/server.mjs";

const root = new URL("../", import.meta.url);

let server;
before(async () => { server = await startTestServer(); });
after(async () => { await server?.stop(); });
async function render(pathname = "/") {
  return fetch(new URL(pathname, server.origin));
}

test("renders the finished wedding invitation", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Dilan/);
  assert.match(html, /Laura/);
  assert.match(html, /10 · 10 · 2026/);
  assert.match(html, /2:30 p\. m\./);
  assert.match(html, /Colosenses 3:14/);
  assert.match(html, /Abrir invitación/);
  assert.match(html, /La Casa Campestre/);
  assert.match(html, /Traje elegante/);
  assert.match(html, /Vestido formal/);
  assert.match(html, /codigo-vestuario-formal-dilan-laura\.webp/);
  assert.match(html, /Blanco y azul: tonos reservados/);
  assert.match(html, /El blanco y el azul están reservados para los novios\./);
  assert.doesNotMatch(html, /todos los tonos de azul/i);
  assert.match(html, /Cada vez falta menos/);
  assert.match(html, /La antesala de nuestro sí/);
  assert.doesNotMatch(html, /Instantes de nuestra historia|Un poco de nosotros/);
  assert.match(html, /¿Nos acompañas\?/);
  assert.match(html, /25 de septiembre de 2026/);
  assert.doesNotMatch(html, /20 de septiembre de 2026/);
  assert.match(html, /Hemos reservado[\s\S]*1 asiento[\s\S]*en tu honor/);
  assert.doesNotMatch(html, /Al abrir, comenzará nuestra canción/);
  assert.doesNotMatch(html, /<figcaption\b/i);
  assert.doesNotMatch(html, /section-kicker light[^>]*>Nuestra historia/i);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});

test("shows the envelope before revealing the invitation", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(css, /\.invitation-content\s*\{[^}]*visibility:\s*hidden/s);
  assert.match(css, /\.site-is-open \.invitation-content\s*\{[^}]*visibility:\s*visible/s);
  assert.doesNotMatch(css, /animation:\s*gate-arrive/);
});

test("ships the music, photographs and social card", async () => {
  await Promise.all([
    access(new URL("public/you-are-the-reason-cello-piano.mp3", root)),
    access(new URL("public/fotos/dilan-laura-portada-jardin-escritorio.webp", root)),
    access(new URL("public/fotos/dilan-laura-portada-jardin-movil.webp", root)),
    access(new URL("public/fotos/dilan-laura-sobre-historia.webp", root)),
    access(new URL("public/fotos/la-casa-campestre.webp", root)),
    access(new URL("public/fotos/dilan-laura-juntos.webp", root)),
    access(new URL("public/fotos/dilan-laura-complicidad-caminando.webp", root)),
    access(new URL("public/fotos/dilan-laura-miradas.webp", root)),
    access(new URL("public/ilustraciones/codigo-vestuario-formal-dilan-laura.webp", root)),
    access(new URL("public/og.png", root)),
  ]);
});

test("keeps personalized invitations out of social metadata", async () => {
  const source = await readFile(new URL("app/i/[token]/page.tsx", root), "utf8");
  assert.match(source, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  assert.match(source, /images:\s*\[\]/);
  assert.doesNotMatch(source, /displayName.*title|displayName.*description/);
});

test("private CSV and authentication fail closed before configuration", async () => {
  const response = await fetch(`${server.origin}/api/admin/rsvps.csv`, {
    headers: { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "owner@example.com" },
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await render("/api/auth/signin")).status, 503);
  assert.match(await (await render("/admin")).text(), /pendiente de configuración/);
});

test("RSVP rejects cross-origin, oversized and malformed requests without touching the database", async () => {
  async function submit(body, headers = {}) {
    return fetch(`${server.origin}/api/rsvp`, { method: "POST", headers: {
      "Content-Type": "application/json", origin: server.origin, ...headers,
    }, body });
  }
  assert.equal((await submit("{}", { origin: "https://another-site.example" })).status, 403);
  assert.equal((await submit("{}", { origin: "" })).status, 403);
  assert.equal((await submit("{}", { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await submit("{" )).status, 400);
  assert.equal((await submit("null")).status, 400);
  assert.equal((await submit(JSON.stringify({ token: "short" }))).status, 404);
  assert.equal((await submit("x".repeat(5000))).status, 413);
  const oversizedUnicode = JSON.stringify({ token: "a".repeat(32), decision: "attending", message: "💙".repeat(1100) });
  assert.equal((await submit(oversizedUnicode)).status, 413);
  const response = await submit(JSON.stringify({ token: "a".repeat(32), decision: "attending" }));
  const expired = Date.now() >= Date.parse("2026-09-26T05:00:00Z");
  assert.equal(response.status, expired ? 410 : 503);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("invalid personalized links return 404 and security headers are present", async () => {
  const response = await render("/i/invalid");
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
});
