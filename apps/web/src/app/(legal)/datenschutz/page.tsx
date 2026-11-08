import { OPERATOR } from "@/lib/legal";

export const metadata = { title: "Datenschutz" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-muted">{children}</div>
    </section>
  );
}

/** Privacy policy of the hosted service (Swiss revDSG and, for users in the EU, GDPR). */
export default function DatenschutzPage() {
  const o = OPERATOR;
  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-semibold">Datenschutzerklärung</h1>

      <Section title="Verantwortlich">
        <p>
          {o.company}, {o.street}, {o.city}, {o.country}. E-Mail:{" "}
          <a className="underline" href={`mailto:${o.email}`}>
            {o.email}
          </a>
        </p>
        <p>
          Diese Erklärung gilt für app.consyrion.com und consyrion.com. Massgebend sind das Schweizer Datenschutzgesetz (DSG) und, für Personen in der EU, die
          Datenschutz-Grundverordnung (DSGVO).
        </p>
      </Section>

      <Section title="Welche Daten wir bearbeiten und wozu">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Konto:</strong> Name, E-Mail-Adresse, Passwort (nur als Hash) oder die Anmeldung über Google bzw. GitHub; Sitzungsdaten. Zweck: Anmeldung
            und Betrieb des Kontos (Vertrag).
          </li>
          <li>
            <strong>Inhalte:</strong> Projektbeschreibungen, hochgeladene Dokumente, Anforderungen, Diskussionen, Entscheidungen, erzeugter Code. Zweck:
            Erbringung des Dienstes (Vertrag).
          </li>
          <li>
            <strong>API-Schlüssel der KI-Anbieter:</strong> verschlüsselt gespeichert (AES-256-GCM), nie im Klartext angezeigt oder protokolliert. Zweck: Aufruf
            der von Ihnen gewählten Modelle (Vertrag).
          </li>
          <li>
            <strong>Nutzung und Abrechnung:</strong> Anzahl Läufe, Token-Zählung pro Modell, Plan und Abo-Status; Zahlungsdaten verarbeitet ausschliesslich
            Stripe, wir sehen nur z. B. die letzten vier Ziffern der Karte. Zweck: Planlimits und Abrechnung (Vertrag, gesetzliche Aufbewahrungspflichten).
          </li>
          <li>
            <strong>Technische Protokolle:</strong> IP-Adresse, Zeitpunkt, aufgerufene Adresse, Fehlermeldungen, ohne Inhalte und ohne Schlüssel. Zweck:
            Sicherheit und stabiler Betrieb (berechtigtes Interesse). Die Protokolle haben eine feste Höchstgrösse und werden fortlaufend überschrieben.
          </li>
        </ul>
        <p>Wir verwenden keine Werbe- oder Analyse-Tracker. Cookies setzen wir nur, soweit sie für die Anmeldung technisch nötig sind.</p>
      </Section>

      <Section title="Weitergabe an KI-Anbieter">
        <p>
          Wenn Sie einen Lauf starten, senden wir die dafür nötigen Inhalte an die von Ihnen ausgewählten KI-Anbieter (z. B. Anthropic, OpenAI, Google,
          DeepSeek, xAI, Moonshot, Z.ai, Alibaba), und zwar mit Ihrem eigenen API-Schlüssel. Diese Anbieter bearbeiten die Daten nach ihren eigenen Bedingungen
          und Datenschutzerklärungen, mit denen Sie selbst einen Vertrag haben. Einige sitzen ausserhalb der Schweiz und der EU (z. B. USA, China). Senden Sie
          keine besonders schützenswerten Daten, wenn Sie das nicht möchten.
        </p>
      </Section>

      <Section title="Weitere Empfänger (Auftragsbearbeiter)">
        <ul className="list-disc space-y-1 pl-5">
          <li>Hetzner Online GmbH, Deutschland: Server und Datenbank (Rechenzentrum in Deutschland).</li>
          <li>Stripe Payments Europe Ltd., Irland, und verbundene Gesellschaften: Zahlungsabwicklung für Pro.</li>
          <li>GitHub, Inc., USA: nur wenn Sie ein Repository verbinden oder sich mit GitHub anmelden.</li>
          <li>Google LLC, USA: nur bei Anmeldung mit Google.</li>
          <li>Vercel Inc., USA: Weiterleitung von consyrion.com auf die App (technische Protokolle).</li>
          <li>
            Hostinger International Ltd., Zypern: E-Mail-Postfach support@consyrion.com und Versand von Entscheidungen per E-Mail, wenn Sie diese Funktion
            nutzen.
          </li>
        </ul>
        <p>
          Bei Übermittlungen in Länder ohne angemessenes Datenschutzniveau stützen wir uns auf die Standardvertragsklauseln der EU-Kommission bzw. den
          Swiss-U.S. Data Privacy Framework, soweit anwendbar.
        </p>
      </Section>

      <Section title="Feedback, Fehlermeldungen und Kontakt">
        <p>
          Wenn Sie uns über das Formular „Feedback“ bzw. „Kontakt & Feedback“ schreiben, speichern wir Art, Betreff und Text der Nachricht, Ihre E-Mail-Adresse
          (bei angemeldeten Nutzern die des Kontos, sonst die von Ihnen angegebene), die Seite, von der Sie schreiben (ohne Parameter), die Sprache der
          Oberfläche, die Browser-Kennung und die App-Version, einen von Ihnen freiwillig angehängten Screenshot sowie unsere Antworten. Zweck: Bearbeitung und
          Beantwortung Ihrer Anfrage und Verbesserung des Dienstes (Vertrag bzw. berechtigtes Interesse). Die Nachricht geht zusätzlich per E-Mail an unsere
          Administratoren (mit Screenshot als Anhang); unsere Antwort senden wir Ihnen auf Wunsch auch per E-Mail an die angegebene Adresse. Ihre eigenen
          Meldungen sind im Datenexport Ihres Arbeitsbereichs enthalten.
        </p>
        <p>
          Wir bewahren Meldungen auf, bis sie erledigt sind und wir sie nicht mehr benötigen; mit dem Löschen des Kontos werden auch Ihre Meldungen gelöscht.
          Auf Wunsch löschen wir eine Meldung samt Antworten sofort – schreiben Sie an {o.email}.
        </p>
      </Section>

      <Section title="Aufbewahrung">
        <p>
          Kontodaten und Inhalte speichern wir, bis Sie sie oder das Konto löschen (in den Einstellungen möglich, inklusive Export aller Daten).
          Datensicherungen (auf dem Server und auf einem Sicherungsspeicher von Hetzner in Deutschland) werden nach 30 Tagen gelöscht. Abrechnungsbelege
          bewahren wir so lange auf, wie es das Gesetz verlangt (in der Schweiz 10 Jahre).
        </p>
        <p className="mt-3">
          Beim Löschen eines Workspaces bleibt nur ein Protokolleintrag ohne Inhalte (dass, wann und von wem gelöscht wurde). Was Sie bereits an Dritte
          übermittelt haben – Pull Requests auf GitHub, per E-Mail, Telegram oder Confluence versendete Berichte, heruntergeladene Exporte – liegt außerhalb
          unseres Zugriffs und wird durch das Löschen nicht entfernt.
        </p>
      </Section>

      <Section title="Ihre Rechte">
        <p>
          Sie können Auskunft, Berichtigung, Löschung, Einschränkung, Herausgabe Ihrer Daten (Datenportabilität) verlangen und einer Bearbeitung aufgrund
          berechtigter Interessen widersprechen. Schreiben Sie an {o.email}. Sie können sich zudem beim Eidgenössischen Datenschutz- und
          Öffentlichkeitsbeauftragten (EDÖB) oder, in der EU, bei der Aufsichtsbehörde Ihres Wohnsitzes beschweren.
        </p>
      </Section>

      <Section title="Sicherheit">
        <p>
          Verbindungen sind verschlüsselt (HTTPS). API-Schlüssel sind verschlüsselt gespeichert, der Zugriff auf Daten ist auf den jeweiligen Arbeitsbereich
          beschränkt. Code der KI-Modelle wird auf unseren Servern nicht ausgeführt.
        </p>
      </Section>
    </article>
  );
}
