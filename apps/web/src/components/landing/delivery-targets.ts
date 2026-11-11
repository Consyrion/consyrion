/**
 * Where a decision can go (#163). `available` only for what is built; everything else is shown as planned
 * (CLAUDE.md: later features appear only as clearly marked "planned" items). Update the status in the PR that
 * ships a target (#164 PDF/Word, #165 e-mail, Telegram, Confluence, Obsidian).
 */
export interface DeliveryTarget {
  name: string;
  detail: string;
  status: "available" | "with_github" | "planned";
}

export const DELIVERY_TARGETS: DeliveryTarget[] = [
  { name: "Decision report", detail: "Recommendation, scores, dissent and evidence in the app", status: "available" },
  { name: "Markdown & JSON", detail: "Export for your notes, wiki or own tools", status: "available" },
  { name: "PDF & Word", detail: "Print-ready report to share or file", status: "available" },
  { name: "E-mail", detail: "Summary with the report attached", status: "available" },
  { name: "Telegram", detail: "Short verdict and link to your chat", status: "available" },
  { name: "Confluence", detail: "A page in your team space", status: "available" },
  { name: "Obsidian", detail: "The report as a note in your vault", status: "available" },
  { name: "GitHub pull request", detail: "Optional build by the Execution Council – reviewed, tested, as a draft", status: "with_github" },
];

export const DELIVERY_STATUS_LABEL: Record<DeliveryTarget["status"], string> = {
  available: "Available",
  with_github: "With a connected repository",
  planned: "Planned",
};
