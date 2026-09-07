import { redirect } from "next/navigation";
import { authIsConfigured, getAdminSession } from "../../lib/auth";
import { databaseIsConfigured } from "../../lib/database";
import {
  getAdminRows,
  notificationsAreConfigured,
  summarizeInvitations,
} from "../../lib/admin";

export const dynamic = "force-dynamic";

const decisionLabels = {
  attending: "Asiste",
  declined: "No asiste",
} as const;

const notificationLabels = {
  pending: "Pendiente",
  sent: "Enviado",
  failed: "Falló",
} as const;

export default async function AdminPage() {
  if (!authIsConfigured()) {
    return (
      <main className="admin-shell">
        <section className="admin-card">
          <p className="section-kicker">Panel privado</p>
          <h1>Acceso privado pendiente de configuración</h1>
          <p>
            Este panel permanecerá cerrado hasta configurar la cuenta autorizada de la pareja.
          </p>
        </section>
      </main>
    );
  }

  const session = await getAdminSession();
  if (!session) redirect("/api/auth/signin?callbackUrl=%2Fadmin");

  if (!databaseIsConfigured()) {
    return (
      <main className="admin-shell">
        <section className="admin-card">
          <p className="section-kicker">Panel privado</p>
          <h1>Falta conectar la base de confirmaciones</h1>
          <p>El acceso ya está protegido. Conecta la base de datos antes de cargar los invitados.</p>
          {/* Auth route handlers require a full-page navigation, not the client page router. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="primary-link" href="/api/auth/signout?callbackUrl=%2F">Cerrar sesión</a>
        </section>
      </main>
    );
  }

  const rows = await getAdminRows();
  const summary = summarizeInvitations(rows);

  return (
    <main className="admin-shell">
      <header>
        <div>
          <p>Panel privado · Dilan &amp; Laura</p>
          <h1>Confirmaciones</h1>
        </div>
        <nav aria-label="Acciones del panel">
          <a href="/api/admin/rsvps.csv">Descargar lista</a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Navigate to the authentication route handler. */}
          <a href="/api/auth/signout?callbackUrl=%2F">Cerrar sesión</a>
        </nav>
      </header>

      {!notificationsAreConfigured() && (
        <p className="admin-note">
          Las respuestas se están guardando. Los avisos por correo se activarán cuando se configure
          el destinatario y el remitente.
        </p>
      )}

      <section className="admin-stats" aria-label="Resumen de confirmaciones">
        <div className="admin-stat"><span>Invitaciones</span><strong>{summary.invitations}</strong></div>
        <div className="admin-stat"><span>Personas que asisten</span><strong>{summary.attending}</strong></div>
        <div className="admin-stat"><span>Personas que no asisten</span><strong>{summary.declined}</strong></div>
        <div className="admin-stat"><span>Personas pendientes</span><strong>{summary.pending}</strong></div>
      </section>
      <p className="admin-note">{summary.seats} cupos reservados en total. Una respuesta por invitación, válida para todo su grupo. Las invitaciones de prueba no se incluyen.</p>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Invitado</th>
              <th>Cupos</th>
              <th>Estado</th>
              <th>Fecha de respuesta</th>
              <th>Mensaje</th>
              <th>Aviso</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6}>La lista de invitados se cargará en el siguiente paso.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.displayName}</td>
                  <td>{row.seatCount}</td>
                  <td>
                    <span className="admin-badge">
                      {row.decision ? decisionLabels[row.decision] : "Pendiente"}
                    </span>
                  </td>
                  <td>{row.submittedAt ?? "—"}</td>
                  <td>{row.message || "—"}</td>
                  <td>
                    {row.notificationStatus
                      ? notificationLabels[row.notificationStatus]
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
