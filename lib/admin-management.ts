import "server-only";
import { queryDatabase } from "./database";

export type Companion = { name: string; additionalSeat: boolean };
export type AdminUpdate = {
  decision: "attending" | "declined" | null;
  companions: Companion[];
  expectedVersion: string;
};

export class AdminUpdateError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function parseAdminUpdate(value: unknown): AdminUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminUpdateError(400, "Los datos enviados no son válidos.");
  }
  const input = value as Record<string, unknown>;
  if (![null, "attending", "declined"].includes(input.decision as string | null)) {
    throw new AdminUpdateError(400, "Selecciona un estado de asistencia válido.");
  }
  if (typeof input.expectedVersion !== "string" || !/^[a-f0-9]{32}$/.test(input.expectedVersion)) {
    throw new AdminUpdateError(400, "Actualiza el panel antes de guardar.");
  }
  if (!Array.isArray(input.companions) || input.companions.length > 20) {
    throw new AdminUpdateError(400, "Puedes registrar hasta 20 acompañantes por invitación.");
  }
  const companions = input.companions.map((item: unknown): Companion => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AdminUpdateError(400, "Revisa los datos del acompañante.");
    }
    const c = item as Record<string, unknown>;
    if (typeof c.name !== "string" || !c.name.trim() || c.name.trim().length > 120 || typeof c.additionalSeat !== "boolean") {
      throw new AdminUpdateError(400, "Cada acompañante necesita un nombre de hasta 120 caracteres y un tipo de cupo.");
    }
    return { name: c.name.trim(), additionalSeat: c.additionalSeat };
  });
  const keys = companions.map(c => c.name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es"));
  if (new Set(keys).size !== keys.length) throw new AdminUpdateError(400, "Hay nombres de acompañantes repetidos en esta invitación.");
  return { decision: input.decision as AdminUpdate["decision"], companions, expectedVersion: input.expectedVersion };
}

export async function updateInvitation(id: number, input: AdminUpdate, actorId: string): Promise<void> {
  try {
    await queryDatabase("SELECT admin_update_invitation($1, $2, $3::jsonb, $4, $5)", [
      id, input.decision, JSON.stringify(input.companions), input.expectedVersion, actorId,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ADMIN_CONFLICT")) throw new AdminUpdateError(409, "Esta invitación cambió mientras la editabas. Actualiza el panel y vuelve a intentarlo.");
    if (message.includes("ADMIN_NOT_FOUND")) throw new AdminUpdateError(404, "No se encontró una invitación activa para editar.");
    if (message.includes("ADMIN_SEATS")) throw new AdminUpdateError(400, "No hay suficientes cupos reservados para esos acompañantes. Usa cupos adicionales cuando corresponda.");
    if (message.includes("ADMIN_INVALID")) throw new AdminUpdateError(400, "Revisa los datos. Una respuesta registrada puede corregirse a Asiste o No asiste.");
    throw error;
  }
}
