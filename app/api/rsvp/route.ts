import {
  saveResponse,
  getInviteByToken,
  isValidTokenShape,
  notifyRsvp,
  RSVP_DEADLINE_UTC,
} from "../../../lib/rsvp";
import { databaseIsConfigured } from "../../../lib/database";
import { isAllowedOrigin } from "../../../lib/origin";
import { after } from "next/server";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return Response.json({ error: "Solicitud no permitida." }, { status: 403, headers: JSON_HEADERS });
  }

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json(
      { error: "El formulario debe enviarse en formato JSON." },
      { status: 415, headers: JSON_HEADERS },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 4096) {
    return Response.json({ error: "El mensaje es demasiado largo." }, { status: 413, headers: JSON_HEADERS });
  }

  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > 4096) {
          await reader.cancel();
          return Response.json({ error: "El mensaje es demasiado largo." }, { status: 413, headers: JSON_HEADERS });
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const rawBody = new TextDecoder().decode(bytes);
    const body = JSON.parse(rawBody) as {
      token?: unknown;
      decision?: unknown;
      message?: unknown;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "La respuesta no es válida." }, { status: 400, headers: JSON_HEADERS });
    }
    const token = typeof body.token === "string" ? body.token : "";
    const decision = body.decision;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!isValidTokenShape(token)) {
      return Response.json({ error: "La invitación no es válida." }, { status: 404, headers: JSON_HEADERS });
    }
    if (decision !== "attending" && decision !== "declined") {
      return Response.json(
        { error: "Selecciona una opción de asistencia." },
        { status: 400, headers: JSON_HEADERS },
      );
    }
    if (message.length > 500) {
      return Response.json(
        { error: "El mensaje puede tener máximo 500 caracteres." },
        { status: 400, headers: JSON_HEADERS },
      );
    }
    if (Date.now() >= RSVP_DEADLINE_UTC) {
      return Response.json(
        { error: "La fecha para confirmar asistencia ya finalizó." },
        { status: 410, headers: JSON_HEADERS },
      );
    }

    if (!databaseIsConfigured()) {
      return Response.json({ error: "Las confirmaciones todavía no están habilitadas." }, { status: 503, headers: JSON_HEADERS });
    }
    const invite = await getInviteByToken(token);
    if (!invite) {
      return Response.json({ error: "La invitación no es válida." }, { status: 404, headers: JSON_HEADERS });
    }
    if (invite.decision) {
      return Response.json(
        { error: "Esta invitación ya tiene una respuesta registrada." },
        { status: 409, headers: JSON_HEADERS },
      );
    }

    const saved = await saveResponse(invite.id, decision, message);
    if (!saved) {
      if (Date.now() >= RSVP_DEADLINE_UTC) {
        return Response.json({ error: "La fecha para confirmar asistencia ya finalizó." }, { status: 410, headers: JSON_HEADERS });
      }
      return Response.json(
        { error: "Esta invitación ya tiene una respuesta registrada." },
        { status: 409, headers: JSON_HEADERS },
      );
    }

    after(() => notifyRsvp(invite.id, invite.displayName, decision, message));

    return Response.json(
      {
        response: saved,
      },
      { status: 201, headers: JSON_HEADERS },
    );
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? "No pudimos leer la respuesta enviada."
        : "No pudimos registrar tu respuesta en este momento.";
    return Response.json({ error: message }, { status: error instanceof SyntaxError ? 400 : 500, headers: JSON_HEADERS });
  }
}
