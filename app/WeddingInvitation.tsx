"use client";

/* eslint-disable @next/next/no-img-element -- pre-optimized local WebP photographs are served directly by the site */

import { useEffect, useMemo, useRef, useState } from "react";

const WEDDING_DATE = new Date("2026-10-10T14:30:00-05:00").getTime();
const RSVP_DEADLINE = "20 de septiembre de 2026";

type Decision = "attending" | "declined";

export type ExistingResponse = {
  decision: Decision;
  message: string;
  submittedAt: string;
};

type WeddingInvitationProps = {
  guestName: string;
  token: string | null;
  initialResponse: ExistingResponse | null;
  preview?: boolean;
};

type Countdown = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function getCountdown(): Countdown {
  const remaining = Math.max(0, WEDDING_DATE - Date.now());
  return {
    days: Math.floor(remaining / 86_400_000),
    hours: Math.floor((remaining / 3_600_000) % 24),
    minutes: Math.floor((remaining / 60_000) % 60),
    seconds: Math.floor((remaining / 1_000) % 60),
  };
}

export function WeddingInvitation({
  guestName,
  token,
  initialResponse,
  preview = false,
}: WeddingInvitationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countdown, setCountdown] = useState<Countdown>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [decision, setDecision] = useState<Decision | "">("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [response, setResponse] = useState<ExistingResponse | null>(initialResponse);
  const [formStatus, setFormStatus] = useState<"idle" | "sending" | "error">("idle");
  const [formError, setFormError] = useState("");
  const [celebrateAttendance, setCelebrateAttendance] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const heroTitleRef = useRef<HTMLHeadingElement>(null);
  const openingTimerRef = useRef<number | null>(null);
  const celebrationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setCountdown(getCountdown()), 0);
    const timer = window.setInterval(() => setCountdown(getCountdown()), 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("invitation-locked", !isOpen);

    let focusTimer: number | undefined;
    if (isOpen) {
      focusTimer = window.setTimeout(() => heroTitleRef.current?.focus(), 120);
    }

    return () => {
      if (focusTimer) window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const elements = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || !("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10%", threshold: 0.14 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [isOpen]);

  useEffect(
    () => () => {
      if (openingTimerRef.current) window.clearTimeout(openingTimerRef.current);
      if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
      document.body.classList.remove(
        "invitation-locked",
        "invitation-opening",
        "invitation-open",
      );
    },
    [],
  );

  const countdownItems = useMemo(
    () => [
      [countdown.days, "Días"],
      [countdown.hours, "Horas"],
      [countdown.minutes, "Minutos"],
      [countdown.seconds, "Segundos"],
    ],
    [countdown],
  );

  function openInvitation() {
    if (isOpening) return;

    setIsOpening(true);
    document.body.classList.add("invitation-opening");

    void audioRef.current?.play().then(
      () => setIsPlaying(true),
      () => setIsPlaying(false),
    );

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    openingTimerRef.current = window.setTimeout(() => {
      setIsOpen(true);
      document.body.classList.remove("invitation-opening");
      document.body.classList.add("invitation-open");
    }, reduceMotion ? 80 : 2100);
  }

  async function toggleMusic() {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }

  function reviewResponse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision) {
      setFormError("Elige una de las dos opciones para continuar.");
      return;
    }
    setFormError("");
    setConfirming(true);
  }

  async function submitResponse() {
    if (!token || !decision) return;
    setFormStatus("sending");
    setFormError("");

    try {
      const request = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, decision, message }),
      });
      const payload = (await request.json()) as {
        error?: string;
        response?: ExistingResponse;
      };

      if (!request.ok || !payload.response) {
        throw new Error(payload.error ?? "No pudimos registrar la respuesta.");
      }

      setResponse(payload.response);
      setConfirming(false);
      setFormStatus("idle");

      if (payload.response.decision === "attending") {
        setCelebrateAttendance(true);
        celebrationTimerRef.current = window.setTimeout(
          () => setCelebrateAttendance(false),
          3600,
        );
      }
    } catch (error) {
      setFormStatus("error");
      setConfirming(false);
      setFormError(
        error instanceof Error
          ? error.message
          : "No pudimos registrar la respuesta. Inténtalo nuevamente.",
      );
    }
  }

  return (
    <main className={isOpen ? "wedding-site site-is-open" : "wedding-site"}>
      {/* Music does not contain spoken dialogue that requires captions. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        preload="metadata"
        src="/you-are-the-reason-cello-piano.mp3"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="page-floral-frame" aria-hidden="true">
        <span className="frame-flower frame-flower-one" />
        <span className="frame-flower frame-flower-two" />
        <span className="frame-flower frame-flower-three" />
      </div>

      <div className="invitation-content" aria-hidden={!isOpen} inert={!isOpen}>
        <section className="hero" aria-label="Invitación de boda de Dilan y Laura">
          <div
            className="hero-image"
            role="img"
            aria-label="Dilan y Laura sonríen abrazados entre flores del jardín"
          />
          <div className="hero-wash" />
          <div className="hero-light-orbit hero-light-orbit-one" aria-hidden="true" />
          <div className="hero-light-orbit hero-light-orbit-two" aria-hidden="true" />
          <div className="botanical botanical-left" aria-hidden="true" />
          <div className="botanical botanical-right" aria-hidden="true" />
          <div className="hero-content">
            <p className="eyebrow">Nos casamos</p>
            <h1 ref={heroTitleRef} tabIndex={-1}>
              Dilan <span>&amp;</span> Laura
            </h1>
            <div className="fine-rule" aria-hidden="true" />
            <p className="date-line">10 · 10 · 2026</p>
            <blockquote className="hero-copy hero-verse">
              <span>“Y sobre todas estas cosas, vestíos de amor, que es el vínculo perfecto”.</span>
              <cite>Colosenses 3:14</cite>
            </blockquote>
          </div>
          <a className="scroll-cue" href="#bienvenida" aria-label="Descubrir la invitación">
            <small>Desliza para descubrir</small>
            <span />
          </a>
        </section>

        <section className="welcome edge-flowers" id="bienvenida" aria-labelledby="welcome-title">
          <div className="reveal">
            <p className="section-kicker">Una invitación para</p>
            <h2 id="welcome-title">{guestName}</h2>
            <p className="seat-reservation">
              Hemos reservado <strong>1 asiento</strong> en tu honor.
            </p>
            <p>
              Nos hará inmensamente felices compartir contigo el comienzo de esta nueva etapa.
            </p>
            <div className="reserved-note">
              <span>Será una celebración íntima, donde cada lugar tiene un nombre.</span>
              <strong>El tuyo está reservado con muchísimo cariño.</strong>
            </div>
          </div>
        </section>

        <section className="story-section" aria-labelledby="story-title">
          <div className="story-stars" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div className="story-inner">
            <div className="story-photo reveal reveal-left">
              <img
                src="/fotos/dilan-laura-sobre-historia.webp"
                alt="Dilan y Laura posan abrazados frente a una puerta antigua"
                width="1400"
                height="2098"
                loading="lazy"
              />
              <span>Una historia que sigue floreciendo</span>
            </div>
            <div className="story-copy reveal reveal-right">
              <span className="story-number" aria-hidden="true">01</span>
              <h2 id="story-title">El amor nos trajo hasta aquí</h2>
              <p>
                Hay historias que se escriben sin prisa: con conversaciones largas, pequeños gestos
                y sueños que, casi sin darnos cuenta, comenzaron a hablar en plural.
              </p>
              <p>
                Hoy elegimos dar el siguiente paso y celebrar el amor que nos ha traído hasta aquí.
              </p>
            </div>
          </div>
        </section>

        <section className="countdown-section" aria-label="Cuenta regresiva para la boda">
          <div className="countdown-rings" aria-hidden="true"><i /><i /><i /></div>
          <div className="reveal">
            <p className="section-kicker light">Cada día falta un poquito menos</p>
            <h2>Hasta volvernos a encontrar</h2>
            <div className="countdown-grid reveal-stagger">
              {countdownItems.map(([value, label]) => (
                <div className="countdown-item" key={label}>
                  <strong key={`${label}-${value}`}>{String(value).padStart(2, "0")}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="event-section edge-flowers" aria-labelledby="event-title">
          <div className="event-photo-wrap reveal reveal-left">
            <img
              className="event-photo"
              src="/fotos/la-casa-campestre.webp"
              alt="Fachada colorida y jardines de La Casa Campestre en Tunja"
              width="1800"
              height="1200"
              loading="lazy"
            />
            <div className="photo-caption">La Casa Campestre · Tunja</div>
          </div>
          <div className="event-copy reveal reveal-right">
            <p className="section-kicker">Nuestro gran día</p>
            <h2 id="event-title">Un mismo lugar, dos momentos inolvidables</h2>
            <p className="event-intro">
              Celebraremos nuestra ceremonia y, al terminar, continuaremos juntos con la recepción.
            </p>
            <div className="event-facts">
              <div>
                <span>Fecha</span>
                <strong><time dateTime="2026-10-10">Sábado, 10 de octubre de 2026</time></strong>
              </div>
              <div>
                <span>Hora</span>
                <strong><time dateTime="14:30">2:30 p. m.</time></strong>
              </div>
              <div>
                <span>Lugar</span>
                <strong>La Casa Campestre</strong>
              </div>
            </div>
            <p className="event-address">
              Diagonal 30 #37–189, barrio La María<br />Tunja, Boyacá
            </p>
            <a
              className="primary-link"
              href="https://maps.app.goo.gl/7JG7GZqVes9Br7xz7"
              target="_blank"
              rel="noreferrer"
            >
              Ver ubicación en Google Maps <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>

        <section className="gallery-section" aria-labelledby="gallery-title">
          <div className="gallery-heading reveal">
            <p className="section-kicker">Cada vez falta menos</p>
            <h2 id="gallery-title">La antesala de nuestro sí</h2>
            <p>Con ilusión en el corazón, contamos los días para celebrar el sí que nos reunirá junto a ustedes.</p>
          </div>
          <div className="gallery-grid reveal reveal-stagger">
            <figure className="gallery-tall gallery-together">
              <img
                src="/fotos/dilan-laura-juntos.webp"
                alt="Dilan y Laura sonríen rodeados de flores"
                width="1200"
                height="1798"
                loading="lazy"
              />
            </figure>
            <figure className="gallery-complicity">
              <img
                src="/fotos/dilan-laura-complicidad-caminando.webp"
                alt="Dilan y Laura caminan de la mano y se miran en el jardín"
                width="1700"
                height="1134"
                loading="lazy"
              />
            </figure>
            <figure className="gallery-glances">
              <img
                src="/fotos/dilan-laura-miradas.webp"
                alt="Dilan y Laura se miran y sonríen sentados en el jardín"
                width="1600"
                height="1129"
                loading="lazy"
              />
            </figure>
          </div>
        </section>

        <div className="journey-marker reveal" aria-label="Continúa hasta la confirmación">
          <span>Sigue bajando</span>
          <small>La confirmación está al final</small>
          <i aria-hidden="true">↓</i>
        </div>

        <section className="dress-section edge-flowers" aria-labelledby="dress-title">
          <figure className="dress-visual reveal reveal-left">
            <img
              src="/ilustraciones/codigo-vestuario-formal-dilan-laura.webp"
              alt="Ilustración de un traje elegante y un vestido formal largo"
              width="1346"
              height="1682"
              loading="lazy"
            />
          </figure>
          <div className="dress-copy reveal reveal-right">
            <p className="section-kicker">El estilo de nuestra celebración</p>
            <h2 id="dress-title">Dress code</h2>
            <p>La ocasión merece un atuendo formal, elegante y especial.</p>
            <div className="attire-options" aria-label="Código de vestuario formal">
              <div className="attire-option">
                <span className="attire-icon attire-icon-suit" aria-hidden="true" />
                <span>
                  <small>Para ellos</small>
                  <strong>Traje elegante</strong>
                </span>
              </div>
              <div className="attire-option">
                <span className="attire-icon attire-icon-dress" aria-hidden="true" />
                <span>
                  <small>Para ellas</small>
                  <strong>Vestido formal</strong>
                </span>
              </div>
            </div>
            <div className="reserved-colors" role="note" aria-label="Colores reservados para los novios">
              <div className="reserved-swatches" aria-hidden="true">
                <i className="reserved-white" />
                <i className="reserved-blue" />
              </div>
              <div>
                <strong>Blanco y azul: tonos reservados</strong>
                <p>El blanco y el azul están reservados para los novios.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="gift-section" aria-labelledby="gift-title">
          <div className="gift-glow" aria-hidden="true" />
          <div className="gift-envelope reveal reveal-left" aria-hidden="true">
            <div className="gift-letter"><span>D &amp; L</span></div>
            <div className="gift-pocket" />
          </div>
          <div className="gift-copy reveal reveal-right">
            <p className="section-kicker light">Tu presencia es nuestro mejor regalo</p>
            <h2 id="gift-title">Lluvia de sobres</h2>
            <p>
              Si deseas tener un detalle con nosotros, hemos elegido la lluvia de sobres.
              Gracias por acompañarnos con tanto cariño.
            </p>
          </div>
        </section>

        <a className="journey-marker journey-marker-final reveal" href="#confirmar">
          <span>Un último paso</span>
          <small>Confirma tu asistencia</small>
          <i aria-hidden="true">↓</i>
        </a>

        <section className="rsvp-section edge-flowers" id="confirmar" aria-labelledby="rsvp-title">
          <div className="rsvp-heading reveal">
            <p className="section-kicker">Confirmación</p>
            <h2 id="rsvp-title">¿Nos acompañas?</h2>
            <p>
              Comparte tu respuesta antes del <strong>{RSVP_DEADLINE}</strong>. Esto nos ayudará a
              preparar con cariño cada lugar.
            </p>
            <small>Este enlace fue preparado especialmente para {guestName}.</small>
          </div>

          <div className="rsvp-card reveal">
            {response ? (
              <div className={`response-message response-${response.decision}`} role="status">
                {response.decision === "attending" && (
                  <div className="response-floral-halo" aria-hidden="true"><i /><i /><i /><i /></div>
                )}
                <span className="response-mark" aria-hidden="true">
                  {response.decision === "attending" ? "✓" : "—"}
                </span>
                <h3>
                  {response.decision === "attending"
                    ? `¡Qué alegría, ${guestName}!`
                    : `Gracias por hacérnoslo saber, ${guestName}.`}
                </h3>
                <p>
                  {response.decision === "attending"
                    ? "Tu lugar ha quedado confirmado. Nos encantará compartir este día contigo."
                    : "Te extrañaremos ese día y agradecemos mucho que formes parte de nuestra historia."}
                </p>
                <small>Esta invitación ya tiene una respuesta registrada.</small>
              </div>
            ) : (
              <form onSubmit={reviewResponse}>
                {preview && (
                  <div className="preview-notice">
                    Vista previa · La confirmación se activará al cargar la lista de invitados
                  </div>
                )}
                <fieldset disabled={preview || formStatus === "sending"}>
                  <legend className="sr-only">Elige tu respuesta</legend>
                  <label className={decision === "attending" ? "choice selected" : "choice"}>
                    <input
                      type="radio"
                      name="decision"
                      value="attending"
                      checked={decision === "attending"}
                      onChange={() => setDecision("attending")}
                    />
                    <span className="choice-icon" aria-hidden="true">✓</span>
                    <span>
                      <strong>Sí, con mucha alegría asistiré</strong>
                      <small>Será hermoso celebrar juntos.</small>
                    </span>
                  </label>
                  <label className={decision === "declined" ? "choice selected" : "choice"}>
                    <input
                      type="radio"
                      name="decision"
                      value="declined"
                      checked={decision === "declined"}
                      onChange={() => setDecision("declined")}
                    />
                    <span className="choice-icon choice-icon-quiet" aria-hidden="true">—</span>
                    <span>
                      <strong>Esta vez no podré acompañarlos</strong>
                      <small>Gracias por hacérnoslo saber.</small>
                    </span>
                  </label>
                  <label className="message-field">
                    <span>Déjanos unas palabras <small>(opcional)</small></span>
                    <textarea
                      maxLength={500}
                      rows={4}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Escribe aquí tu mensaje para Dilan y Laura"
                    />
                  </label>
                </fieldset>

                <p className="final-answer-note">
                  Revisa tu elección antes de confirmar. Para cuidar la organización, tu respuesta
                  quedará registrada de forma definitiva.
                </p>

                {formError && <p className="form-error" role="alert">{formError}</p>}

                <button className="submit-button" type="submit" disabled={preview || formStatus === "sending"}>
                  {preview ? "Disponible con tu enlace personal" : "Revisar mi respuesta"}
                </button>
              </form>
            )}
          </div>
        </section>

        <footer>
          <p>Con todo nuestro amor,</p>
          <strong>Dilan &amp; Laura</strong>
          <span>10 · 10 · 2026</span>
          <small>Nuestra historia apenas comienza.</small>
        </footer>
      </div>

      {isOpen && (
        <button className="music-control" type="button" onClick={toggleMusic} aria-pressed={isPlaying}>
          <span aria-hidden="true">{isPlaying ? "Ⅱ" : "♪"}</span>
          {isPlaying ? "Pausar música" : "Reproducir música"}
        </button>
      )}

      {!isOpen && (
        <div
          className={isOpening ? "invitation-gate is-opening" : "invitation-gate"}
          role="dialog"
          aria-modal="true"
          aria-label="Abrir invitación"
          aria-busy={isOpening}
        >
          <div className="gate-aurora gate-aurora-one" aria-hidden="true" />
          <div className="gate-aurora gate-aurora-two" aria-hidden="true" />
          <div className="gate-floral gate-floral-left" aria-hidden="true" />
          <div className="gate-floral gate-floral-right" aria-hidden="true" />
          <div className="gate-sparkles" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>

          <div className="envelope-scene">
            <div className="wedding-envelope">
              <div className="envelope-back" aria-hidden="true" />
              <div className="gate-reveal-card">
                <div
                  className="gate-reveal-photo"
                  role="img"
                  aria-label="Dilan y Laura abrazados frente a una puerta antigua"
                />
                <div className="gate-reveal-wash" aria-hidden="true" />
                <div className="gate-reveal-copy">
                  <p>Para {guestName}</p>
                  <strong>Dilan <span>&amp;</span> Laura</strong>
                  <small>Invitación personal · 1 lugar reservado</small>
                </div>
              </div>
              <div className="envelope-pocket-left" aria-hidden="true" />
              <div className="envelope-pocket-right" aria-hidden="true" />
              <div className="envelope-pocket-bottom" aria-hidden="true" />
              <div className="envelope-flap" aria-hidden="true" />
              <button
                className="wax-seal"
                type="button"
                onClick={openInvitation}
                disabled={isOpening}
                aria-label="Abrir invitación"
              >
                <span>D <em>&amp;</em> L</span>
              </button>
            </div>
            <p className="gate-date">10 · 10 · 2026</p>
            <p className="gate-instruction">
              {isOpening ? "Preparada especialmente para ti" : "Toca el sello para abrir"}
            </p>
          </div>
        </div>
      )}

      {confirming && (
        <div className="confirm-dialog-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="section-kicker">Una última revisión</p>
            <h2 id="confirm-title">
              {decision === "attending" ? "Confirmas que asistirás" : "Confirmas que no podrás asistir"}
            </h2>
            <p>Esta respuesta será definitiva para que podamos reservar cada lugar con cuidado.</p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConfirming(false)}
                disabled={formStatus === "sending"}
              >
                Volver
              </button>
              <button
                className="submit-button"
                type="button"
                onClick={submitResponse}
                disabled={formStatus === "sending"}
              >
                {formStatus === "sending" ? "Guardando…" : "Sí, confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {celebrateAttendance && (
        <div className="attendance-celebration" aria-hidden="true">
          <span className="celebration-flower celebration-flower-one"><i /><i /><i /><i /><b /></span>
          <span className="celebration-flower celebration-flower-two"><i /><i /><i /><i /><b /></span>
          <span className="celebration-flower celebration-flower-three"><i /><i /><i /><i /><b /></span>
          <span className="celebration-flower celebration-flower-four"><i /><i /><i /><i /><b /></span>
          <em /><em /><em /><em /><em /><em />
        </div>
      )}
    </main>
  );
}
