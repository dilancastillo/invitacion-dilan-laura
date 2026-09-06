"use client";
export default function InvitationError({ reset }: { reset: () => void }) {
  return (
    <main className="admin-shell">
      <section className="admin-card">
        <p className="section-kicker">Dilan &amp; Laura</p>
        <h1>Un momento, por favor</h1>
        <p>No pudimos abrir tu invitación en este momento. Inténtalo nuevamente en unos minutos.</p>
        <button className="primary-link" type="button" onClick={reset}>Volver a intentar</button>
      </section>
    </main>
  );
}
