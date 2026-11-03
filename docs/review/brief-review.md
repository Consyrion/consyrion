# Kritische Prüfung des Master-Briefs (#58 / „CONSYRION anforderung teil1.docx“)

Stand 25.10.2026. Der Brief wurde mit ChatGPT erstellt. Diese Prüfung trennt, was übernommen wird, was
angepasst wird und was als Risiko offen bleibt.

## Was stark ist und übernommen wird
- **Kernidee**: unabhängige Vorschläge, dann Kritik, Schutz von Minderheitsmeinungen, menschliche Freigabe.
  Das adressiert echte Schwächen von Multi-Agent-Systemen (Gruppendenken, Gefälligkeits-Zustimmung).
- **Minority Review als eigene Phase** und „keine Lösung erfüllt die Anforderungen“ als gültiges Ergebnis.
- **Keine Fake-Daten**, keine erfundenen Testergebnisse, Freigabe vor Code und Merge.
- **Sicherheitsgrundsätze** (Mandantentrennung, verschlüsselte Keys, Sandboxes, Budgets).

## Was ich anders mache oder ausdrücklich einschränke

| Punkt im Brief | Problem | Umsetzung |
|---|---|---|
| Sieben Phasen, jede mit eigenen Modellaufrufen | Open Council, 12 Minds Council, Minority Review und Final Verdict lassen Modelle mehrfach ähnliche Kritik schreiben. Ein Lauf mit 3 Modellen × 12 Rollen × 2 Runden erzeugt schnell **über 100 Aufrufe** mit langen Kontexten – teuer und minutenlang. | Alle sieben Phasen bleiben eigene Workflow-Stufen, aber Aufrufe werden gebündelt (eine Rolle bewertet alle Vorschläge in einem Aufruf). Kostenvorschau vor dem Start, harte Token-Budgets serverseitig, kleine Standardwerte. |
| „12 Minds Council“ mit 12 Rollen | Zwölf Rollen auf demselben Modell sind **keine zwölf unabhängigen Stimmen**; Fehler sind korreliert. Echte Vielfalt kommt von verschiedenen Modellen, nicht von Rollentiteln. | Rollenzahl konfigurierbar (Standard 4–6). Mehrheiten werden pro Modell gezählt, nicht pro Rolle. Bericht weist aus, wie viele unabhängige Modelle beteiligt waren. |
| Gewichtete Scores 0–10 mit Nachkommastellen | LLM-Bewertungen sind verrauscht und bevorzugen lange oder dem eigenen Stil ähnliche Antworten. Gewichtete Summen täuschen Präzision vor. | Keine Selbstbewertung, Streuung der Bewerter wird angezeigt, knappe Abstände gelten als Gleichstand und gehen an den Menschen. |
| Fehlende Erfolgsmessung | Das eigene Konzept (docs/KONZEPT.md, Abschnitt 8) verlangte einen **Vergleichsmodus**: Ist der Rat besser als ein einzelnes starkes Modell? Der Brief hat das gestrichen. Ohne diesen Nachweis fehlt das Verkaufsargument. | Evaluations-Harness (#33) wird vorgezogen: gleiche Aufgaben einmal per Einzelmodell, einmal per Rat. |
| Eigene Coding-Sandboxes, Agenten, GitHub App (M4/M5) | Das ist ein eigenes Produkt (vergleichbar mit GitHub Copilot Coding Agent, Claude Code, Devin, Cursor). Hoher Aufwand und Infrastrukturkosten, der Markt ist besetzt. Das Alleinstellungsmerkmal ist die **Entscheidungsschicht**. | Execution Council wird als schlanke Übergabe gebaut: Entscheidung → Implementierungsplan → Draft-PR durch einen Agenten in einer isolierten Umgebung. Option, die Umsetzung an vorhandene Coding-Agenten zu übergeben, statt alles selbst zu betreiben. |
| Vier Tarife, Credits, Admin-Bereich (M6) vor Produkt-Markt-Fit | Abrechnung ist erst sinnvoll, wenn Nutzer den Rat tatsächlich wiederholt verwenden. | Tarife und Limits nur als konfigurierbares Gerüst, keine echte Zahlungsabwicklung ohne Freigabe. |
| Privater Code an drei Anbieter | Datenschutz und Unternehmensverträge mit **jedem** Anbieter nötig – Verkaufshürde bei Firmen. | Pro Projekt sichtbar, welche Anbieter welche Daten erhalten; Repository-Inhalte nur nach ausdrücklicher Freigabe. |
| VS-Code-Extension (M7) | Nützlich, aber erst nach stabiler API wertvoll. | Nach M2/M3, auf derselben API. |

## Widersprüche und Fehler im Brief und in den Issues
- Domain: Issues #1–#48 nennen `consyrion.ai`, Brief und #58 `consyrion.com` (gekauft ist .com).
- Bereichsnamen: „Council/Build/Teams“ (#47) vs. „Decision/Build/Workspace“ (Brief).
- README nannte Firebase, der Brief PostgreSQL. Umgesetzt: PostgreSQL.
- Doppelte Issues: #19 = #21, #20 = #22. Viele Issues tragen dieselbe generische Checkliste ohne konkrete Abnahmekriterien.
- Mockups zeigen veraltete Modellnamen (GPT-4o, Claude 3.5, Gemini 1.5). Die App lädt Modelle live und zeigt keine festen Namen.
- „12 Minds“ lehnt sich an „12 Angry Men“ an; der Brief verlangt zu Recht, Filmtitel nicht zu verwenden. Der Name selbst ist unkritisch, sollte aber in die Markenprüfung (siehe CONSYRION_BRAND_CHECK.md, Risiko „Consirion“).

## Empfehlung zur Reihenfolge
1. M2 Entscheidungs-Engine + M3 Oberfläche (der eigentliche Produktkern).
2. Vergleichsmodus/Evaluation mit echten Keys: Bringt der Rat messbar bessere Entscheidungen?
3. Erst danach M4–M7 im vollen Umfang. Bis dahin werden sie als schlanke, ehrlich gekennzeichnete Versionen gebaut.
