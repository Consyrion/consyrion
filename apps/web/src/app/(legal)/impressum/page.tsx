import { OPERATOR } from "@/lib/legal";

export const metadata = { title: "Impressum" };

export default function ImpressumPage() {
  const o = OPERATOR;
  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-semibold">Impressum</h1>
      <section>
        <h2 className="text-lg font-semibold">Anbieter</h2>
        <p className="mt-2 text-muted">
          {o.company === o.brand ? null : (
            <>
              {o.brand} ist ein Angebot von:
              <br />
            </>
          )}
          {o.company}
          <br />
          {o.street}
          <br />
          {o.city}
          <br />
          {o.country}
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Kontakt</h2>
        <p className="mt-2 text-muted">
          E-Mail:{" "}
          <a className="underline" href={`mailto:${o.email}`}>
            {o.email}
          </a>
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Haftung für Inhalte und Links</h2>
        <p className="mt-2 text-muted">
          Die Inhalte dieser Website werden mit Sorgfalt erstellt. Für Richtigkeit, Vollständigkeit und Aktualität übernehmen wir keine Gewähr. Für Inhalte
          externer Websites, auf die wir verlinken, sind ausschliesslich deren Betreiber verantwortlich. Antworten der KI-Modelle stammen von den jeweiligen
          Anbietern und werden nicht von uns geprüft (siehe AGB).
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Quellcode</h2>
        <p className="mt-2 text-muted">
          {o.brand} ist freie Software unter der GNU Affero General Public License v3.0. Der Quellcode ist öffentlich unter{" "}
          <a className="underline" href="https://github.com/Consyrium/consyrium">
            github.com/Consyrium/consyrium
          </a>{" "}
          verfügbar.
        </p>
      </section>
    </article>
  );
}
