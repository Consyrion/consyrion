import Link from "next/link";
import { OPERATOR } from "@/lib/legal";

export const metadata = { title: "AGB" };

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">
        {n}. {title}
      </h2>
      <div className="mt-2 space-y-2 text-muted">{children}</div>
    </section>
  );
}

/** General terms of the hosted service app.consyrion.com (Free and Pro). Self-hosting is governed by the AGPL-3.0 only. */
export default function AgbPage() {
  const o = OPERATOR;
  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-semibold">Allgemeine Geschäftsbedingungen (AGB)</h1>

      <Section n={1} title="Geltungsbereich und Vertragspartner">
        <p>
          Diese AGB gelten für die Nutzung des Online-Dienstes {o.brand} unter app.consyrion.com. Vertragspartner ist {o.company}, {o.street}, {o.city},{" "}
          {o.country} (nachfolgend «wir»). Abweichende Bedingungen von Nutzerinnen und Nutzern gelten nicht.
        </p>
        <p>Wer {o.brand} selbst betreibt (Download des Quellcodes), schliesst keinen Vertrag mit uns ab; dafür gilt allein die Lizenz GNU AGPL-3.0.</p>
      </Section>

      <Section n={2} title="Leistung">
        <p>
          {o.brand} lässt mehrere KI-Modelle eine Frage oder ein Vorhaben unabhängig bearbeiten, Vorschläge gegenseitig prüfen und eine dokumentierte Empfehlung
          erstellen. Im Plan Pro kann ein von der Nutzerin oder dem Nutzer gewähltes Modell eine freigegebene Lösung als Entwurfs-Pull-Request in einem eigenen
          GitHub-Repository umsetzen. Zusammengeführt (merge) oder veröffentlicht wird nie automatisch.
        </p>
        <p>
          Die KI-Modelle werden über die eigenen API-Schlüssel der Nutzerin oder des Nutzers bei den jeweiligen Anbietern (z. B. Anthropic, OpenAI, Google)
          aufgerufen («Bring your own key»). Für diese Nutzung gelten die Bedingungen und Preise dieser Anbieter; die Kosten stellen sie direkt in Rechnung. Wir
          verkaufen keine KI-Nutzung und haften nicht für Leistungen, Ausfälle oder Preise der KI-Anbieter.
        </p>
      </Section>

      <Section n={3} title="Keine Gewähr für KI-Ergebnisse">
        <p>
          Antworten, Bewertungen, Empfehlungen und Code der KI-Modelle können falsch, unvollständig oder veraltet sein. Sie ersetzen keine fachliche,
          rechtliche, medizinische oder finanzielle Beratung. Entscheidungen und das Zusammenführen von Code liegen allein in der Verantwortung der Nutzerin
          oder des Nutzers; erzeugten Code vor dem Einsatz prüfen und testen.
        </p>
      </Section>

      <Section n={4} title="Konto und Pflichten">
        <p>
          Für die Nutzung ist ein Konto nötig. Zugangsdaten und API-Schlüssel sind vertraulich zu behandeln. Untersagt sind rechtswidrige Inhalte, die
          Verletzung von Rechten Dritter, Angriffe auf den Dienst sowie eine Nutzung, die den Betrieb für andere übermässig beeinträchtigt. Bei Verstössen
          können wir das Konto sperren.
        </p>
        <p>Hochgeladene Inhalte bleiben im Eigentum der Nutzerin oder des Nutzers; wir verarbeiten sie nur, um den Dienst zu erbringen.</p>
      </Section>

      <Section n={5} title="Pläne und Preise">
        <p>
          <strong>Free:</strong> kostenlos, mit den in der App angezeigten Grenzen (derzeit 2 Council-Läufe pro Monat, ohne Umsetzung auf GitHub).
          <br />
          <strong>Pro:</strong> 4,99 € pro Monat inklusive gesetzlicher Mehrwertsteuer, mit den in der App angezeigten Leistungen.
        </p>
        <p>
          Massgebend sind die bei Vertragsschluss in der App angezeigten Preise und Grenzen. Preisänderungen gelten nur für neue Abonnements oder nach
          vorheriger Mitteilung mit Kündigungsmöglichkeit.
        </p>
      </Section>

      <Section n={6} title="Zahlung, Laufzeit und Kündigung">
        <p>
          Die Zahlung erfolgt im Voraus über den Zahlungsdienstleister Stripe. Das Abonnement Pro verlängert sich jeweils um einen Monat, bis es gekündigt wird.
          Eine Kündigung ist jederzeit zum Ende des laufenden Abrechnungsmonats möglich, unter «Abo verwalten» in den Einstellungen. Danach gilt der Plan Free.
        </p>
        <p>Schlägt eine Zahlung fehl, kann der Zugang auf den Plan Free zurückgesetzt werden. Bereits bezahlte Zeiträume werden nicht anteilig erstattet.</p>
      </Section>

      <Section n={7} title="Widerrufsrecht für Verbraucher in der EU">
        <p>
          Verbraucherinnen und Verbraucher mit Wohnsitz in der EU können einen Vertrag über Pro innerhalb von 14 Tagen ab Vertragsschluss ohne Angabe von
          Gründen widerrufen. Dazu genügt eine eindeutige Erklärung (z. B. E-Mail an {o.email}). Wir erstatten die Zahlung innerhalb von 14 Tagen. Wurde auf
          ausdrücklichen Wunsch mit der Leistung vor Ablauf der Widerrufsfrist begonnen, ist ein dem bereits erbrachten Anteil entsprechender Betrag zu
          bezahlen.
        </p>
      </Section>

      <Section n={8} title="Verfügbarkeit und Änderungen">
        <p>
          Wir bemühen uns um einen störungsfreien Betrieb, schulden aber keine bestimmte Verfügbarkeit. Wartungen, Ausfälle der KI-Anbieter oder von GitHub
          können die Nutzung einschränken. Wir dürfen den Dienst weiterentwickeln, solange die wesentlichen Leistungen von Pro erhalten bleiben.
        </p>
      </Section>

      <Section n={9} title="Haftung">
        <p>
          Wir haften unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie nach zwingenden gesetzlichen Vorschriften. Im Übrigen ist die Haftung, soweit
          gesetzlich zulässig, auf die in den letzten zwölf Monaten bezahlten Beträge beschränkt; für Folgeschäden, entgangenen Gewinn und Datenverlust haften
          wir nicht, soweit gesetzlich zulässig.
        </p>
      </Section>

      <Section n={10} title="Datenschutz">
        <p>
          Wie wir Personendaten bearbeiten, steht in der{" "}
          <Link className="underline" href="/datenschutz">
            Datenschutzerklärung
          </Link>
          .
        </p>
      </Section>

      <Section n={11} title="Änderungen der AGB">
        <p>
          Änderungen teilen wir mindestens 30 Tage vor Inkrafttreten per E-Mail oder in der App mit. Wer nicht einverstanden ist, kann bis dahin kündigen; sonst
          gelten die neuen AGB.
        </p>
      </Section>

      <Section n={12} title="Anwendbares Recht und Gerichtsstand">
        <p>
          Es gilt Schweizer Recht unter Ausschluss des UN-Kaufrechts. Gerichtsstand ist der Sitz von {o.company}. Zwingende Schutzvorschriften des
          Wohnsitzstaates von Verbraucherinnen und Verbrauchern und deren gesetzlicher Gerichtsstand bleiben vorbehalten.
        </p>
      </Section>
    </article>
  );
}
