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
  return `CONSYRION ${day} ${title || "decision"}.md`;
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
  date: Date;
  labels: { source: string; run: string; models: string; date: string; status: string };
}): string {
  const runUrl = `${input.serverUrl}/sessions/${input.sessionId}`;
  const yaml = (value: string) => JSON.stringify(value);
  const front = [
    "---",
    `consyrion_session: ${yaml(input.sessionId)}`,
    `consyrion_url: ${yaml(runUrl)}`,
    `consyrion_status: ${yaml(input.status)}`,
    `consyrion_models: [${input.models.map(yaml).join(", ")}]`,
    ...(input.sourcePath ? [`source: ${yaml(`[[${input.sourcePath.replace(/\.md$/, "")}]]`)}`] : []),
    `created: ${input.date.toISOString()}`,
    "---",
    "",
  ];
  const meta = [
    ...(input.sourcePath ? [`- ${input.labels.source}: [[${input.sourcePath.replace(/\.md$/, "")}]]`] : []),
    `- ${input.labels.run}: [${input.sessionId}](${runUrl})`,
    `- ${input.labels.models}: ${input.models.join(", ") || "–"}`,
    `- ${input.labels.status}: ${input.status}`,
    `- ${input.labels.date}: ${input.date.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
  ];
  return `${front.join("\n")}${meta.join("\n")}\n${input.report.trim()}\n`;
}
