import { csvCell, getAdminRows, requireAdminApi } from "../../../../lib/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireAdminApi();
  if (!access.ok) return access.response;

  const rows = await getAdminRows();
  const header = [
    "Invitado",
    "Cupos reservados",
    "Personas confirmadas",
    "Respuesta",
    "Fecha de respuesta",
    "Mensaje",
    "Estado del aviso",
  ];
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.displayName,
        row.seatCount,
        row.decision === "attending" ? row.seatCount : row.decision === "declined" ? 0 : null,
        row.decision === "attending"
          ? "Asiste"
          : row.decision === "declined"
            ? "No asiste"
            : "Pendiente",
        row.submittedAt,
        row.message,
        row.notificationStatus,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];

  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="confirmaciones-dilan-laura.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
