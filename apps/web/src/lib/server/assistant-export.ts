import "server-only";
import { checkSummary, isSensitiveTopic, type CheckVerdict } from "../council-check";

/**
 * A stored assistant chat as Markdown (#280): title, then every message with who wrote it, when, the model, the pages
 * it linked and its suggested actions. Content is written as stored – the user's own data, exported for them only.
 * #486: the cross-checks of a council chat go with the answer they checked (overall label, every verdict with its
 * reason), so the document never looks more certain than the chat.
 */
export interface ExportLabels {
  you: string;
  assistant: string;
  exported: string;
  links: string;
  actions: string;
  /** Cross-check labels (#486); without them checks are left out. */
  checks?: {
    heading: string;
    verdict: Record<CheckVerdict, string>;
    summary: Record<"confirmed" | "contradicted" | "unverified", string>;
    sensitive: string;
  };
}

export interface ExportCheck {
  messageId: string;
  model: string;
  verdict: CheckVerdict;
  reason: string;
}

const VERDICT_MARK: Record<CheckVerdict, string> = { confirmed: "✓", contradicted: "⚠", unverifiable: "?" };

export interface ExportMessage {
  id?: string;
  role: string;
  content: string;
  model?: string | null;
  createdAt: Date | string;
  links?: Array<{ label: string; href: string }> | null;
  actions?: Array<{ summary?: string | null; status?: string | null }> | null;
}

export function chatMarkdown(
  chat: { title: string },
  messages: ExportMessage[],
  options: {
    labels: ExportLabels;
    formatDate: (d: Date) => string;
    appUrl: string;
    now?: Date;
    checks?: ExportCheck[];
    /** ✓/⚠/? before each verdict – off for the PDF, whose font has no such characters (they would print as "?"). */
    marks?: boolean;
  },
): string {
  const { labels, formatDate } = options;
  const base = options.appUrl.replace(/\/$/, "");
  const lines = [`# ${chat.title.replace(/[\r\n]+/g, " ")}`, "", `_${labels.exported}: ${formatDate(options.now ?? new Date())}_`, ""];
  let question = "";
  for (const m of messages) {
    if (m.role === "user") question = m.content;
    const who = m.role === "user" ? labels.you : `${labels.assistant}${m.model ? ` (${m.model})` : ""}`;
    // App links inside the answer ("[Project](/projects/…)") become absolute, so they work outside the app (live test 08.11.26).
    const content = m.content.trim().replace(/\]\((\/(?!\/)[^)\s]*)\)/g, (_all, href: string) => `](${base}${href})`);
    lines.push(`## ${who} · ${formatDate(new Date(m.createdAt))}`, "", content, "");
    const links = (m.links ?? []).filter((l) => l.href.startsWith("/"));
    if (links.length) lines.push(`${labels.links}:`, ...links.map((l) => `- [${l.label.replace(/[[\]]/g, "")}](${base}${l.href})`), "");
    const actions = (m.actions ?? []).filter((a) => a.summary);
    if (actions.length) lines.push(`${labels.actions}:`, ...actions.map((a) => `- ${a.summary}${a.status ? ` (${a.status})` : ""}`), "");
    const checks = labels.checks && m.id ? (options.checks ?? []).filter((c) => c.messageId === m.id) : [];
    if (labels.checks && checks.length) {
      const sensitive = isSensitiveTopic(question);
      const summary = checkSummary(
        checks.map((c) => c.verdict),
        sensitive,
      )!;
      lines.push(`**${labels.checks.heading}: ${labels.checks.summary[summary]}${sensitive ? ` – ${labels.checks.sensitive}` : ""}**`);
      lines.push(
        ...checks.map(
          (c) =>
            `- ${options.marks === false ? "" : `${VERDICT_MARK[c.verdict]} `}${labels.checks!.verdict[c.verdict]} – ${c.model}: ${c.reason.replace(/\s+/g, " ").trim()}`,
        ),
        "",
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** File name from the title: letters, digits and dashes only. */
export function exportFileName(title: string): string {
  const slug = title
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return `consyrium-chat-${slug || "export"}.md`;
}
