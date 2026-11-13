/** Report notes (#103): file names that never overwrite an existing note, and a header with run data. Pure functions. */

/** A file name from the question: no characters Obsidian or file systems refuse, at most 80 characters. */
export function reportFileName(question: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  const title = question
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `CONSYRIUM ${day} ${title || "decision"}.md`;
}

/** The first free path: "name.md", then "name (2).md", "name (3).md" … – an existing note is never replaced. */
export function freePath(folder: string, fileName: string, exists: (path: string) => boolean): string {
  const base = folder.replace(/^\/+|\/+$/g, "");
  const join = (name: string) => (base ? `${base}/${name}` : name);
  if (!exists(join(fileName))) return join(fileName);
  const stem = fileName.replace(/\.md$/, "");
  for (let n = 2; n < 1000; n++) {
    const candidate = join(`${stem} (${n}).md`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error("No free file name");
}

/**
 * The saved note: YAML front matter with the run's real data (no token, no secrets), links to the source note and the
 * run, then the server's Markdown report unchanged.
 */
export function reportNote(input: {
  report: string;
  sessionId: string;
  serverUrl: string;
  sourcePath: string | null;
  models: string[];
  status: string;
  /** Shown before the full report: the answer in short (see `answerBlock`). */
  answer?: string;
  /** The status in words for the visible header; the front matter keeps the machine value. */
  statusLabel?: string;
  date: Date;
  labels: { source: string; run: string; models: string; date: string; status: string };
}): string {
  const runUrl = `${input.serverUrl}/sessions/${input.sessionId}`;
  const yaml = (value: string) => JSON.stringify(value);
  const front = [
    "---",
    `consyrium_session: ${yaml(input.sessionId)}`,
    `consyrium_url: ${yaml(runUrl)}`,
    `consyrium_status: ${yaml(input.status)}`,
    `consyrium_models: [${input.models.map(yaml).join(", ")}]`,
    ...(input.sourcePath ? [`source: ${yaml(`[[${input.sourcePath.replace(/\.md$/, "")}]]`)}`] : []),
    `created: ${input.date.toISOString()}`,
    "---",
    "",
  ];
  const meta = [
    ...(input.sourcePath ? [`- ${input.labels.source}: [[${input.sourcePath.replace(/\.md$/, "")}]]`] : []),
    `- ${input.labels.run}: [${input.sessionId}](${runUrl})`,
    `- ${input.labels.models}: ${input.models.join(", ") || "–"}`,
    `- ${input.labels.status}: ${input.statusLabel ?? input.status}`,
    `- ${input.labels.date}: ${input.date.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
  ];
  return `${front.join("\n")}${meta.join("\n")}\n${input.answer ? `${input.answer.trim()}\n\n---\n\n` : ""}${input.report.trim()}\n`;
}

/**
 * "The answer first" (owner feedback 11.11.26: a list of ideas was buried under the whole debate): title, summary and
 * the recommended steps of the solution the council recommends, taken unchanged from the structured report. Empty when
 * there is nothing to show – the full report below is never shortened or replaced.
 */
export function answerBlock(
  solution: { label?: string; author?: string; title?: string; summary?: string; recommendations?: string[] } | null,
  labels: { heading: string; proposal: string; fullReport: string },
): string {
  if (!solution) return "";
  const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  const steps = (Array.isArray(solution.recommendations) ? solution.recommendations : []).map(clean).filter(Boolean);
  const title = clean(solution.title);
  const summary = clean(solution.summary);
  if (!title && !summary && !steps.length) return "";
  const head = [clean(solution.label) ? `${labels.proposal} ${clean(solution.label)}` : "", title].filter(Boolean).join(" – ");
  return [
    `## ${labels.heading}`,
    "",
    ...(head ? [`**${head}**${clean(solution.author) ? ` (${clean(solution.author)})` : ""}`, ""] : []),
    ...(summary ? [summary, ""] : []),
    ...steps.map((step) => `- ${step}`),
    ...(steps.length ? [""] : []),
    `_${labels.fullReport}_`,
  ].join("\n");
}

/**
 * True when the server's report already starts with the answer (servers since 12.11.26 print "The answer in brief"
 * under the result): the first recommended step stands in the first quarter of the report. Older servers list the
 * steps only at the end under "Next steps" – then the plugin adds its own block. Checked by content, so it works in
 * every report language.
 */
export function reportLeadsWithAnswer(report: string, solution: { recommendations?: string[] } | null): boolean {
  const first = (Array.isArray(solution?.recommendations) ? solution.recommendations : [])
    .map((step) => (typeof step === "string" ? step.trim() : ""))
    .find(Boolean);
  if (!first) return false;
  const at = report.indexOf(first.slice(0, 80));
  return at >= 0 && at < report.length / 4;
}
