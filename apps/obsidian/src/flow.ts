import type { ConsyriumApi, Mode, Participant } from "./api";
import { ConsyriumError } from "./api";

/**
 * Prepares a council from the selected text (#103): a ready project whose brief is exactly the shown text, and a
 * requirement list confirmed from the user's own requirement lines only – sentences of the text stay context, lines
 * that look like instructions to the models are refused (the user decides in the app). Same rules as ask_consyrium.
 */
export async function prepareProject(
  api: ConsyriumApi,
  input: { question: string; text: string; goal: string; requirements: string[]; excludedReason?: string },
): Promise<{ projectId: string; requirements: string[] }> {
  const question = input.question.replace(/\s+/g, " ").trim();
  const idea = [question, input.text.trim()].filter(Boolean).join("\n\n");
  const { project } = await api.createProject({
    name: question.slice(0, 120) || "Decision from Obsidian",
    idea: idea.length >= 20 ? idea : `${idea} – decision requested from Obsidian`,
    goal: input.goal.trim() || question,
    requirements: input.requirements.map((r) => r.trim()).filter(Boolean),
  });
  const { proposal } = await api.requirementProposal(project.id);
  if (proposal.toDecide.length)
    throw new ConsyriumError("validation", `instructions:${proposal.toDecide.map((t) => `"${t.text.slice(0, 60)}"`).join(", ")}`, 400);
  const confirmed = proposal.items.filter((i) => i.source.kind === "requirements");
  const fromText = proposal.items.filter((i) => i.source.kind !== "requirements" && i.candidateKey);
  await api.confirmRequirements(project.id, {
    sourceHash: proposal.source.hash,
    items: confirmed.map((i) => ({ text: i.text, candidateKey: i.candidateKey })),
    excluded: [
      ...proposal.excluded.map((e) => ({ candidateKey: e.candidateKey, reason: e.reason })),
      ...fromText.map((i) => ({ candidateKey: i.candidateKey!, reason: input.excludedReason ?? CONTEXT_REASON })),
    ],
    noHardRequirements: confirmed.length === 0,
  });
  return { projectId: project.id, requirements: confirmed.map((i) => i.text) };
}

export function validateTeam(participants: Participant[]) {
  return participants.length >= 2 && participants.length <= 6;
}

/** A stable key per prepared council: a retry after a timeout replays the same session instead of starting a second one. */
export function idempotencyKey(projectId: string, mode: Mode, participants: Participant[], tokenBudget: number): string {
  const raw = `${projectId}|${mode}|${tokenBudget}|${participants.map((p) => `${p.credentialId}:${p.modelId}`).join(",")}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) hash = Math.imul(hash ^ raw.charCodeAt(i), 0x01000193) >>> 0;
  return `obsidian-${projectId}-${hash.toString(16)}`;
}

/** Filter of the model list in the dialog: every word must occur in the model name, the provider or the key label. */
export function matchesModelFilter(query: string, model: { name: string; provider: string; label: string }): boolean {
  const haystack = `${model.name} ${model.provider} ${model.label}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Why a sentence of the note was not taken as a requirement (stored with the list and printed in the report). */
export const CONTEXT_REASON = "Context from the Obsidian note, not a requirement the user listed";

/**
 * Requirement lines the selected text itself lists: the list items directly under a line that announces requirements
 * ("Requirements:", "Feste Anforderungen:", "## Must haves" …). They only pre-fill the dialog's requirement field – the
 * user sees, edits or deletes them before anything is sent, so the confirmed list stays the user's own.
 */
export function suggestRequirements(text: string): string[] {
  const announces = /(anforderung|requirement|bedingung|constraint|must[- ]have|muss[- ]kriteri)/i;
  const item = /^\s*(?:[-*+•]|\d+[.)])\s+(.+?)\s*$/;
  const found: string[] = [];
  let collecting = false;
  for (const line of text.split("\n")) {
    const match = item.exec(line);
    if (collecting && match) found.push(match[1]!.replace(/^\[[ xX]\]\s*/, ""));
    else if (!match && line.trim()) collecting = announces.test(line) && line.trim().length <= 80;
  }
  return [...new Set(found)].slice(0, 20);
}

/**
 * The question the dialog starts with: the first line of the selection only when it is a question. A heading or an
 * ordinary first sentence is not what the user asks (11.11.26: a council was titled after the note's heading), so the
 * field stays empty and has to be filled in.
 */
export function initialQuestion(text: string): string {
  const first = (text.split("\n").find((line) => line.trim()) ?? "").replace(/^#+\s*/, "").trim();
  return /[?？]$/.test(first) ? first.slice(0, 120) : "";
}
