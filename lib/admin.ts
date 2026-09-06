import "server-only";
import { getAdminSession } from "./auth";
import { queryDatabase } from "./database";
import { getRuntimeEnv } from "./rsvp";

export type AdminRow = {
  id: number;
  displayName: string;
  decision: "attending" | "declined" | null;
  message: string | null;
  submittedAt: string | null;
  notificationStatus: "pending" | "sent" | "failed" | null;
};

export async function requireAdminApi(): Promise<
  { ok: true } | { ok: false; response: Response }
> {
  const session = await getAdminSession();
  if (!session) {
    return {
      ok: false,
      response: Response.json({ error: "Debes iniciar sesión con una cuenta autorizada." }, {
        status: 401, headers: { "Cache-Control": "private, no-store" },
      }),
    };
  }

  return { ok: true };
}

export async function getAdminRows(): Promise<AdminRow[]> {
  return queryDatabase<AdminRow>(
      `SELECT
        g.id AS id,
        g.display_name AS "displayName",
        r.decision AS decision,
        r.message AS message,
        to_char(r.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "submittedAt",
        r.notification_status AS "notificationStatus"
      FROM guests g
      LEFT JOIN rsvps r ON r.guest_id = g.id
      WHERE g.active = true
      ORDER BY lower(g.display_name) ASC`,
    );
}

export function notificationsAreConfigured(): boolean {
  const runtime = getRuntimeEnv();
  return Boolean(
    runtime.RSVP_NOTIFY_TO?.trim() &&
      runtime.RSVP_EMAIL_FROM?.trim() &&
      runtime.RESEND_API_KEY?.trim(),
  );
}

export function csvCell(value: string | number | null): string {
  let normalized = value == null ? "" : String(value);
  // eslint-disable-next-line no-control-regex -- Also neutralize formulas hidden behind control characters.
  if (/^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replace(/"/g, '""')}"`;
}
