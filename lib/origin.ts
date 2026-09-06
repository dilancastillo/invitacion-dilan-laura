export function getSiteOrigin(): string {
  const configured = process.env.SITE_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const candidate = configured || (vercelHost ? `https://${vercelHost}` : "http://localhost:3000");
  const url = new URL(candidate);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:" && !process.env.VERCEL)) {
    throw new Error("Configura una dirección HTTPS para la invitación.");
  }
  if (url.username || url.password) throw new Error("La dirección de la invitación no es válida.");
  return url.origin;
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  const allowed = new Set([getSiteOrigin()]);
  // These are platform-owned environment variables, never request headers or wildcards.
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);
  return allowed.has(origin);
}
