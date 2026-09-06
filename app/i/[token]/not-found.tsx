import Link from "next/link";

export default function InvitationNotFound() {
  return (
    <main className="not-found-shell">
      <section className="not-found-card">
        <p className="section-kicker">Dilan &amp; Laura</p>
        <h1>No encontramos esta invitación</h1>
        <p>
          Revisa que el enlace esté completo. Si el problema continúa, comunícate directamente con
          la pareja para recibir un nuevo enlace.
        </p>
        <Link className="primary-link" href="/">Volver al inicio</Link>
      </section>
    </main>
  );
}
