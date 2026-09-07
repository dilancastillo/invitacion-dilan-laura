import "server-only";
import { queryDatabase } from "./database";

export type Decision = "attending" | "declined";
export type InviteRecord = {
  id: number;
  displayName: string;
  seatCount: number;
  isTest: boolean;
  decision: Decision | null;
  message: string | null;
  submittedAt: string | null;
};
export type SavedResponse = { decision: Decision; message: string; submittedAt: string };
export const RSVP_DEADLINE_UTC = Date.parse("2026-09-21T05:00:00.000Z");

export function getRuntimeEnv() {
  return {
    RSVP_NOTIFY_TO: process.env.RSVP_NOTIFY_TO,
    RSVP_EMAIL_FROM: process.env.RSVP_EMAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isValidTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,128}$/.test(token);
}

export async function getInviteByToken(token: string): Promise<InviteRecord | null> {
  if (!isValidTokenShape(token)) return null;
  const records = await queryDatabase<InviteRecord>(
    `SELECT g.id, g.display_name AS "displayName", g.seat_count AS "seatCount", g.is_test AS "isTest", r.decision, r.message,
      to_char(r.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "submittedAt"
     FROM guests g LEFT JOIN rsvps r ON r.guest_id = g.id
     WHERE g.token_hash = $1 AND g.active = true LIMIT 1`,
    [await sha256Hex(token)],
  );
  return records[0] ?? null;
}

export async function saveResponse(guestId: number, decision: Decision, message: string): Promise<SavedResponse | null> {
  // The primary key and ON CONFLICT make the first response immutable, even for simultaneous requests.
  const records = await queryDatabase<SavedResponse>(
    `INSERT INTO rsvps (guest_id, decision, message)
     SELECT id, $2, $3 FROM guests
     WHERE id = $1 AND active = true AND is_test = false AND CURRENT_TIMESTAMP < $4::timestamptz
     ON CONFLICT (guest_id) DO NOTHING
     RETURNING decision, message,
       to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "submittedAt"`,
    [guestId, decision, message, new Date(RSVP_DEADLINE_UTC).toISOString()],
  );
  return records[0] ?? null;
}

export async function notifyRsvp(guestId: number, displayName: string, decision: Decision, message: string, seatCount = 1): Promise<"pending" | "sent" | "failed"> {
  const runtime = getRuntimeEnv();
  const recipient = runtime.RSVP_NOTIFY_TO?.trim();
  const sender = runtime.RSVP_EMAIL_FROM?.trim();
  const apiKey = runtime.RESEND_API_KEY?.trim();
  if (!recipient || !sender || !apiKey) return "pending";
  const decisionLabel = decision === "attending"
    ? seatCount > 1 ? `Sí asistirán (${seatCount} personas)` : "Sí asistirá (1 persona)"
    : seatCount > 1 ? `No podrán asistir (${seatCount} personas)` : "No podrá asistir (1 persona)";

  try {
    const request = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        from: sender, to: [recipient], subject: `Nueva confirmación de ${displayName}`,
        text: `${displayName} ha registrado su respuesta: ${decisionLabel}.\n\nMensaje: ${message || "Sin mensaje adicional"}`,
        html: `<p><strong>${escapeHtml(displayName)}</strong> ha registrado su respuesta: <strong>${decisionLabel}</strong>.</p><p>Mensaje: ${escapeHtml(message || "Sin mensaje adicional")}</p>`,
      }),
    });
    if (!request.ok) throw new Error(`Servicio de correo: estado ${request.status}.`);
    await queryDatabase(
      `UPDATE rsvps SET notification_status = 'sent', notification_attempts = notification_attempts + 1,
       notification_sent_at = CURRENT_TIMESTAMP, notification_last_error = NULL WHERE guest_id = $1`, [guestId],
    );
    return "sent";
  } catch {
    // Email failures must never turn a saved RSVP into an apparent submission failure.
    try {
      await queryDatabase(
        `UPDATE rsvps SET notification_status = 'failed', notification_attempts = notification_attempts + 1,
         notification_last_error = 'No se pudo completar el aviso por correo.' WHERE guest_id = $1`, [guestId],
      );
    } catch { /* The saved decision remains authoritative even when the notification audit fails. */ }
    return "failed";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}
