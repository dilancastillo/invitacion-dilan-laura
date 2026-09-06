import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

export async function startTestServer(overrides = {}) {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url)),
    "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    windowsHide: true,
    env: {
      ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", SITE_URL: origin,
      NEXTAUTH_URL: origin, DATABASE_URL: "", GITHUB_ID: "", GITHUB_SECRET: "",
      ADMIN_GITHUB_IDS: "", NEXTAUTH_SECRET: "", RSVP_NOTIFY_TO: "", RSVP_EMAIL_FROM: "",
      RESEND_API_KEY: "", VERCEL: "", VERCEL_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "",
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-5000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-5000); });
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  };
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw new Error(`Next.js exited: ${output}`);
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(2000) });
        if (response.ok) return { origin, stop };
      } catch { /* Wait for the local server, never a remote service. */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Next.js did not become ready: ${output}`);
  } catch (error) {
    await stop();
    throw error;
  }
}
