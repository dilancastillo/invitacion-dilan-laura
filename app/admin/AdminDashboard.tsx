"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AdminRow } from "../../lib/admin";
import "./admin.css";

type AttendanceFilter = "all" | "attending" | "declined" | "pending";
type CompanionDraft = { key: number; name: string; additionalSeat: boolean };

const decisionLabels = { attending: "Asiste", declined: "No asiste", pending: "Pendiente" };
const notificationLabels = { pending: "Pendiente", sent: "Enviado", failed: "Falló" };
const filters: { value: AttendanceFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "attending", label: "Asisten" },
  { value: "declined", label: "No asisten" },
  { value: "pending", label: "Pendientes" },
];
const dateFormat = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota",
});

function searchable(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

function responseDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

export default function AdminDashboard({ rows }: { rows: AdminRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<AttendanceFilter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const counts = {
    all: rows.length,
    attending: rows.filter((row) => row.decision === "attending").length,
    declined: rows.filter((row) => row.decision === "declined").length,
    pending: rows.filter((row) => row.decision === null).length,
  };
  const summary = rows.reduce((totals, row) => {
    totals.seats += row.seatCount;
    totals[row.decision ?? "pending"] += row.seatCount;
    return totals;
  }, { seats: 0, attending: 0, declined: 0, pending: 0 });
  const query = searchable(search.trim());
  const visibleRows = rows.filter((row) => (
    (filter === "all" || (row.decision ?? "pending") === filter) &&
    (!query || searchable([row.displayName, ...row.companions.map((person) => person.name)].join(" ")).includes(query))
  ));
  const visibleSeats = visibleRows.reduce((sum, row) => sum + row.seatCount, 0);

  function refresh() {
    startRefresh(() => router.refresh());
  }

  return (
    <div className="admin-dashboard">
      <section className="admin-stats" aria-label="Resumen de todas las confirmaciones">
        <div className="admin-stat"><span>Invitaciones</span><strong>{rows.length}</strong></div>
        <div className="admin-stat"><span>Personas que asisten</span><strong>{summary.attending}</strong></div>
        <div className="admin-stat"><span>Personas que no asisten</span><strong>{summary.declined}</strong></div>
        <div className="admin-stat"><span>Personas pendientes</span><strong>{summary.pending}</strong></div>
      </section>
      <p className="admin-note">
        {summary.seats} {summary.seats === 1 ? "cupo" : "cupos"} en total, incluidos los acompañantes con cupo adicional.
        Una respuesta por invitación, válida para todo su grupo. Las invitaciones de prueba no se incluyen.
      </p>

      <section className="admin-controls" aria-label="Buscar y filtrar invitaciones">
        <div className="admin-filter-group" role="group" aria-label="Estado de asistencia">
          {filters.map((item) => (
            <button key={item.value} type="button" aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}>
              {item.label}<span>{counts[item.value]}</span>
            </button>
          ))}
        </div>
        <label className="admin-search">
          <span>Buscar invitado o acompañante</span>
          <input type="search" value={search} placeholder="Escribe un nombre…"
            onChange={(event) => setSearch(event.target.value)} />
        </label>
      </section>

      <div className="admin-results-line">
        <p role="status">{visibleRows.length} de {rows.length} {rows.length === 1 ? "invitación" : "invitaciones"} · {visibleSeats} {visibleSeats === 1 ? "cupo" : "cupos"} en esta lista</p>
        {(query || filter !== "all") && (
          <button type="button" className="admin-text-button" onClick={() => { setSearch(""); setFilter("all"); }}>
            Limpiar filtros
          </button>
        )}
      </div>
      <div className="admin-feedback" role="status" aria-live="polite">
        {notice && <p className="admin-success">{notice}{refreshing ? " Actualizando el panel…" : ""}</p>}
      </div>

      <div className="admin-table-wrap" aria-busy={refreshing}>
        <table className="admin-table admin-guest-table">
          <caption className="sr-only">Invitaciones y acompañantes. Fechas en hora de Colombia.</caption>
          <thead><tr>
            <th scope="col">Invitado y acompañantes</th><th scope="col">Cupos</th>
            <th scope="col">Estado</th><th scope="col">Respuesta · Colombia</th>
            <th scope="col">Mensaje</th><th scope="col">Aviso</th><th scope="col">Gestionar</th>
          </tr></thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr><td colSpan={7} className="admin-empty">
                {rows.length ? "No hay invitaciones que coincidan con estos filtros." : "Todavía no hay invitaciones registradas."}
              </td></tr>
            ) : visibleRows.map((row) => (
              <tr key={row.id}>
                <td data-label="Invitado" className="admin-guest-name">
                  <strong>{row.displayName}</strong>
                  {row.companions.length > 0 && (
                    <ul className="admin-companion-list" aria-label={`Acompañantes de ${row.displayName}`}>
                      {row.companions.map((person, index) => (
                        <li key={`${index}-${person.name}`}>
                          <span>{person.name}</span>
                          <small>{person.additionalSeat ? "Cupo adicional" : "Cupo ya reservado"}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td data-label="Cupos">{row.seatCount}</td>
                <td data-label="Estado">
                  <span className={`admin-badge admin-badge-${row.decision ?? "pending"}`}>
                    {decisionLabels[row.decision ?? "pending"]}
                  </span>
                  {row.responseSource === "admin" && <small className="admin-source">Registro manual</small>}
                </td>
                <td data-label="Respuesta · Colombia">{responseDate(row.submittedAt)}</td>
                <td data-label="Mensaje" className="admin-message">{row.message || "—"}</td>
                <td data-label="Aviso">{row.responseSource === "admin" ? "No aplica" : row.notificationStatus ? notificationLabels[row.notificationStatus] : "—"}</td>
                <td className="admin-row-actions">
                  <button type="button" className="admin-edit-button" disabled={refreshing}
                    aria-label={`Editar asistencia y acompañantes de ${row.displayName}`}
                    onClick={() => { setNotice(""); setEditing(row); }}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <InvitationEditor key={`${editing.id}-${editing.version}`} row={editing}
        onClose={() => setEditing(null)}
        onReload={() => { setEditing(null); refresh(); }}
        onSaved={() => {
          setNotice(`Se guardaron los cambios de ${editing.displayName}.`);
          setEditing(null);
          refresh();
        }} />}
    </div>
  );
}

function InvitationEditor({ row, onClose, onSaved, onReload }: {
  row: AdminRow;
  onClose: () => void;
  onSaved: () => void;
  onReload: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nextKey = useRef(row.companions.length);
  const [decision, setDecision] = useState<string>(row.decision ?? "pending");
  const [companions, setCompanions] = useState<CompanionDraft[]>(
    row.companions.map((person, key) => ({ ...person, key })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const originalSeats = row.seatCount - row.companions.filter((person) => person.additionalSeat).length;
  const addedSeats = companions.filter((person) => person.additionalSeat).length;
  const totalSeats = originalSeats + addedSeats;
  const reservedCompanions = companions.length - addedSeats;
  const tooManyReserved = reservedCompanions > Math.max(0, originalSeats - 1);
  const payloadCompanions = companions.map(({ name, additionalSeat }) => ({ name: name.trim(), additionalSeat }));
  const originalCompanions = row.companions.map(({ name, additionalSeat }) => ({ name, additionalSeat }));
  const dirty = decision !== (row.decision ?? "pending") || JSON.stringify(payloadCompanions) !== JSON.stringify(originalCompanions);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function updateCompanion(key: number, update: Partial<CompanionDraft>) {
    setCompanions((current) => current.map((person) => person.key === key ? { ...person, ...update } : person));
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || conflict || !dirty) return;
    if (tooManyReserved) {
      setError("Hay más acompañantes que cupos disponibles en la invitación original. Marca los que requieren un cupo adicional.");
      return;
    }
    if (payloadCompanions.some((person) => !person.name)) {
      setError("Escribe el nombre de cada acompañante antes de guardar.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/invitations/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: decision === "pending" ? null : decision,
          companions: payloadCompanions,
          expectedVersion: row.version,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) {
        if (response.status === 409) {
          setConflict(true);
          throw new Error("Esta invitación cambió mientras la editabas. Recarga los datos y vuelve a aplicar tus cambios.");
        }
        throw new Error(typeof result?.error === "string" ? result.error : "No se pudo guardar. Inténtalo de nuevo.");
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.");
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} className="admin-editor" aria-labelledby="admin-editor-title"
      aria-describedby="admin-editor-description"
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
      <form onSubmit={save}>
        <header className="admin-editor-header">
          <div><p>Gestionar invitación</p><h2 id="admin-editor-title">{row.displayName}</h2></div>
          <button type="button" className="admin-close" aria-label="Cerrar editor" disabled={saving} onClick={onClose}>×</button>
        </header>
        <p id="admin-editor-description" className="admin-editor-help">
          Registra aquí las confirmaciones recibidas por llamada o mensaje y los nombres de los acompañantes.
        </p>

        <fieldset className="admin-editor-fields" disabled={saving || conflict}>
          <legend className="sr-only">Asistencia y acompañantes</legend>
          <label className="admin-field">
            <span>Estado de asistencia</span>
            <select value={decision} onChange={(event) => { setDecision(event.target.value); setError(""); }}>
              <option value="attending">Asiste</option>
              <option value="declined">No asiste</option>
              {row.decision === null && <option value="pending">Pendiente</option>}
            </select>
          </label>
          <p className="admin-field-hint">Los acompañantes comparten el estado de esta invitación.</p>

          <section className="admin-companions-editor" aria-labelledby="admin-companions-title">
            <div className="admin-companions-heading">
              <h3 id="admin-companions-title">Acompañantes</h3>
              <span>{companions.length} {companions.length === 1 ? "registrado" : "registrados"}</span>
            </div>
            <p className="admin-field-hint">
              Usa «Cupo ya reservado» si el acompañante estaba incluido en la reserva original ({originalSeats} {originalSeats === 1 ? "cupo" : "cupos"}).
              Elige «Cupo adicional» para sumar una persona al total.
            </p>
            {companions.length === 0 && <p className="admin-no-companions">Aún no hay nombres de acompañantes registrados.</p>}
            {companions.map((person, index) => (
              <div className="admin-companion-fields" key={person.key}>
                <label className="admin-field">
                  <span>Nombre del acompañante {index + 1}</span>
                  <input type="text" required maxLength={120} value={person.name} autoComplete="off"
                    onChange={(event) => updateCompanion(person.key, { name: event.target.value })} />
                </label>
                <label className="admin-field">
                  <span>Cupo</span>
                  <select value={person.additionalSeat ? "additional" : "reserved"}
                    aria-label={`Cupo del acompañante ${index + 1}`}
                    onChange={(event) => updateCompanion(person.key, { additionalSeat: event.target.value === "additional" })}>
                    <option value="reserved">Cupo ya reservado</option>
                    <option value="additional">Cupo adicional (+1)</option>
                  </select>
                </label>
                <button type="button" className="admin-remove-button" aria-label={`Quitar acompañante ${index + 1}`}
                  onClick={() => { setCompanions((current) => current.filter((item) => item.key !== person.key)); setError(""); }}>
                  Quitar
                </button>
              </div>
            ))}
            <button type="button" className="admin-add-button" disabled={companions.length >= 20}
              onClick={() => {
                const key = nextKey.current++;
                setCompanions((current) => [...current, {
                  key, name: "", additionalSeat: reservedCompanions >= originalSeats - 1,
                }]);
              }}>
              + Agregar acompañante
            </button>
            {companions.length >= 20 && <p className="admin-field-hint">Máximo 20 acompañantes por invitación.</p>}
          </section>

          <div className="admin-seat-preview" aria-live="polite">
            <span>{originalSeats} {originalSeats === 1 ? "cupo original" : "cupos originales"} + {addedSeats} {addedSeats === 1 ? "adicional" : "adicionales"}</span>
            <strong>{totalSeats} {totalSeats === 1 ? "cupo en total" : "cupos en total"}</strong>
          </div>
          {tooManyReserved && <p className="admin-validation" role="alert">Los cupos originales incluyen al titular. Cambia a «Cupo adicional» los acompañantes que excedan los cupos reservados.</p>}
          {row.message && (
            <section className="admin-original-message" aria-label="Mensaje original del invitado">
              <h3>Mensaje original del invitado</h3><p>{row.message}</p>
            </section>
          )}
        </fieldset>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <footer className="admin-editor-actions">
          <button type="button" className="admin-cancel-button" disabled={saving} onClick={onClose}>Cancelar</button>
          {conflict ? (
            <button type="button" className="admin-save-button" onClick={onReload}>Recargar datos</button>
          ) : (
            <button type="submit" className="admin-save-button" disabled={saving || !dirty || tooManyReserved}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
