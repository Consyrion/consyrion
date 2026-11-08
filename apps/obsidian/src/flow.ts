import type { ConsyrionApi, Mode, Participant } from "./api";
import { ConsyrionError } from "./api";

/**
 * Prepares a council from the selected text (#103): a ready project whose brief is exactly the shown text, and a
 * requirement list confirmed from the user's own requirement lines only – sentences of the text stay context, lines
 * that look like instructions to the models are refused (the user decides in the app). Same rules as ask_consyrion.
 */
export async function prepareProject(
  api: ConsyrionApi,
  input: { question: string; text: string; goal: string; requirements: string[] },
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
    throw new ConsyrionError("validation", `instructions:${proposal.toDecide.map((t) => `"${t.text.slice(0, 60)}"`).join(", ")}`, 400);
  const confirmed = proposal.items.filter((i) => i.source.kind === "requirements");
  const fromText = proposal.items.filter((i) => i.source.kind !== "requirements" && i.candidateKey);
  await api.confirmRequirements(project.id, {
    sourceHash: proposal.source.hash,
    items: confirmed.map((i) => ({ text: i.text, candidateKey: i.candidateKey })),
    excluded: [
      ...proposal.excluded.map((e) => ({ candidateKey: e.candidateKey, reason: e.reason })),
      ...fromText.map((i) => ({ candidateKey: i.candidateKey!, reason: "Context from the Obsidian note, not a requirement the user listed" })),
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
