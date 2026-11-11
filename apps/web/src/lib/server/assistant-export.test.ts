import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { chatMarkdown, exportFileName } = await import("./assistant-export");

const labels = { you: "Du", assistant: "Assistent", exported: "Exportiert", links: "Seiten", actions: "Vorgeschlagene Aktionen" };

describe("assistant chat export (#280)", () => {
  it("writes title, every message with author, time and model, app links as absolute links and suggested actions", () => {
    const md = chatMarkdown(
      { title: "Welche Schritte\nsind offen?" },
      [
        { role: "user", content: "Welche Schritte sind offen?", createdAt: "2026-11-08T10:00:00Z" },
        {
          role: "assistant",
          content: "Eine Entscheidung wartet auf dich: [Beitragslauf](/sessions/ses_1), extern [x](https://x.example/a).",
          model: "anthropic/claude-haiku-5-5",
          createdAt: "2026-11-08T10:00:05Z",
          links: [
            { label: "Beitragslauf", href: "/sessions/ses_1" },
            { label: "fremd", href: "https://evil.example/x" },
          ],
          actions: [{ summary: "Entwurf für den Kunden", status: "proposed" }],
        },
      ],
      { labels, formatDate: (d) => d.toISOString().slice(0, 16), appUrl: "https://app.example.test/", now: new Date("2026-11-08T11:00:00Z") },
    );
    expect(md).toBe(
      [
        "# Welche Schritte sind offen?",
        "",
        "_Exportiert: 2026-11-08T11:00_",
        "",
        "## Du · 2026-11-08T10:00",
        "",
        "Welche Schritte sind offen?",
        "",
        "## Assistent (anthropic/claude-haiku-5-5) · 2026-11-08T10:00",
        "",
        "Eine Entscheidung wartet auf dich: [Beitragslauf](https://app.example.test/sessions/ses_1), extern [x](https://x.example/a).",
        "",
        "Seiten:",
        "- [Beitragslauf](https://app.example.test/sessions/ses_1)",
        "",
        "Vorgeschlagene Aktionen:",
        "- Entwurf für den Kunden (proposed)",
        "",
      ].join("\n"),
    );
  });

  it("puts the cross-checks under the answer they checked, with the overall label and every reason (#486)", () => {
    const checksLabels = {
      heading: "Gegenprüfung",
      verdict: { confirmed: "bestätigt", contradicted: "widersprochen", unverifiable: "nicht prüfbar" },
      summary: { confirmed: "Von den anderen Modellen bestätigt", contradicted: "Widersprochen – lies die Einwände", unverified: "Nicht verifiziert" },
      sensitive: "Medizin, Recht oder Sicherheit: immer von einer Fachperson prüfen lassen",
    };
    const messages = [
      { id: "m1", role: "user", content: "Monolith oder Microservices?", createdAt: "2026-11-08T10:00:00Z" },
      { id: "m2", role: "assistant", content: "Monolith.", model: "anthropic/claude-haiku-5-5", createdAt: "2026-11-08T10:00:05Z" },
      { id: "m3", role: "assistant", content: "Microservices.", model: "openai/gpt-5.4-mini", createdAt: "2026-11-08T10:00:06Z" },
      { id: "m4", role: "user", content: "Ist das DSGVO-konform?", createdAt: "2026-11-08T10:01:00Z" },
      { id: "m5", role: "assistant", content: "Ja.", model: "anthropic/claude-haiku-5-5", createdAt: "2026-11-08T10:01:05Z" },
    ];
    const checks = [
      { messageId: "m2", model: "openai/gpt-5.4-mini", verdict: "contradicted" as const, reason: "Bei  3 Teams\nbesser getrennt." },
      { messageId: "m5", model: "openai/gpt-5.4-mini", verdict: "confirmed" as const, reason: "Stimmt." },
    ];
    const md = chatMarkdown({ title: "Council" }, messages, {
      labels: { ...labels, checks: checksLabels },
      checks,
      formatDate: () => "8. Nov. 2026",
      appUrl: "https://app.consyrium.com",
    });
    expect(md).toContain("**Gegenprüfung: Widersprochen – lies die Einwände**\n- ⚠ widersprochen – openai/gpt-5.4-mini: Bei 3 Teams besser getrennt.");
    // Law/data protection is never "confirmed", however many models agree.
    expect(md).toContain("**Gegenprüfung: Nicht verifiziert – Medizin, Recht oder Sicherheit: immer von einer Fachperson prüfen lassen**\n- ✓ bestätigt");
    // The unchecked answer has no check block; without labels checks are left out.
    expect(md.split("Gegenprüfung").length - 1).toBe(2);
    expect(chatMarkdown({ title: "x" }, messages, { labels, checks, formatDate: () => "d", appUrl: "https://a" })).not.toContain("Gegenprüfung");
    // PDF: words only, no ✓/⚠ that the PDF font would print as "?".
    const pdfText = chatMarkdown({ title: "x" }, messages, {
      labels: { ...labels, checks: checksLabels },
      checks,
      marks: false,
      formatDate: () => "d",
      appUrl: "https://a",
    });
    expect(pdfText).toContain("- widersprochen – openai/gpt-5.4-mini");
    expect(pdfText).not.toMatch(/[✓⚠]/);
  });

  it("builds a safe file name from the title", () => {
    expect(exportFileName("Größe: Postgres / SQLite?")).toBe("consyrium-chat-grosse-postgres-sqlite.md");
    expect(exportFileName("???")).toBe("consyrium-chat-export.md");
  });
});
