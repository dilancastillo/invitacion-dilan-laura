import { getAdminSession } from "../../../../../lib/auth";
import { databaseIsConfigured } from "../../../../../lib/database";
import { isAllowedOrigin } from "../../../../../lib/origin";
import { AdminUpdateError, parseAdminUpdate, updateInvitation } from "../../../../../lib/admin-management";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session?.adminGithubId) return Response.json({ error: "Debes iniciar sesión con una cuenta autorizada." }, { status: 401, headers });
  if (!isAllowedOrigin(request.headers.get("origin"))) return Response.json({ error: "Solicitud no permitida." }, { status: 403, headers });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Envía los datos en formato JSON." }, { status: 415, headers });
  }
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) {
    return Response.json({ error: "La invitación no es válida." }, { status: 400, headers });
  }
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new AdminUpdateError(400, "Faltan los datos de la invitación.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); throw new AdminUpdateError(413, "Los datos enviados son demasiado largos."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const input = parseAdminUpdate(JSON.parse(new TextDecoder().decode(bytes)));
    if (!databaseIsConfigured()) throw new AdminUpdateError(503, "La base de confirmaciones no está disponible.");
    await updateInvitation(Number(id), input, session.adminGithubId);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof AdminUpdateError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof SyntaxError) return Response.json({ error: "No pudimos leer los datos enviados." }, { status: 400, headers });
    return Response.json({ error: "No pudimos guardar los cambios. Vuelve a intentarlo." }, { status: 500, headers });
  }
}
