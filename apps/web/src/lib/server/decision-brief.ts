import type { SessionView } from "@consyrion/council";

/**
 * What an editor agent (Cursor, Claude Code over MCP) needs to act on a decision (owner request 07.11.26): the chosen or
 * leading proposal in full – architecture, components, risks with mitigations, assumptions, next steps – the hard
 * requirements with their check status, the open objections and the human decision, plus a short Markdown brief.
 * Built only from stored data; model output is quoted as written.
 */
type ProposalContent = {
  title?: string;
  summary?: string;
  architecture?: string;
  components?: string[];
  advantages?: string[];
  disadvantages?: string[];
  risks?: Array<{ risk: string; severity: string; mitigation: string }>;
  costEstimate?: string;
  assumptions?: string[];
  recommendations?: string[];
};
type GateRequirement = { requirementId: string; status: string };
type Matrix = {
  proposals?: Array<{ proposalId: string; total: number | null }>;
  requirementGate?: { proposals?: Array<{ proposalId: string; requirements: GateRequirement[] }> };
};

export type DecisionBrief = ReturnType<typeof decisionBrief>;

export function decisionBrief(view: SessionView) {
  const matrix = (view.decision?.matrix ?? {}) as Matrix;
  const approval = view.approvals.at(-1);
  const approved = view.session.status === "approved";
  // Which proposal the brief is about: what the human approved, else the recommendation, else the best-scored one.
  const best = [...(matrix.proposals ?? [])].sort((a, b) => (b.total ?? -1) - (a.total ?? -1))[0]?.proposalId ?? null;
  const chosenId = (approved ? approval?.selectedProposalId : null) ?? view.decision?.recommendedProposalId ?? best;
  const proposal = view.proposals.find((p) => p.id === chosenId) ?? null;
  const content = (proposal?.revisions.at(-1)?.content ?? {}) as ProposalContent;
  const basis = !proposal
    ? null
    : approved
      ? "approved_by_human"
      : view.decision?.recommendedProposalId === proposal.id && view.decisionStatus?.approvable
        ? "recommended_awaiting_approval"
        : "leading_not_approvable";
  const gate = matrix.requirementGate?.proposals?.find((g) => g.proposalId === proposal?.id);
  const requirements = (view.requirementList?.items ?? []).map((item: { id: string; text: string }) => ({
    id: item.id,
    text: item.text,
    status: gate?.requirements.find((r) => r.requirementId === item.id)?.status ?? "UNKNOWN",
  }));
  const objections = view.objections
    .filter((o) => o.proposalId === proposal?.id && ["open", "accepted", "unresolved"].includes(o.status) && !o.moot)
    .map((o) => ({ severity: o.severity, category: o.category, status: o.status, claim: o.claim, evidence: o.evidence || null, blocking: o.blocking }));

  const chosen = proposal
    ? {
        label: proposal.label,
        basis,
        title: content.title ?? null,
        summary: content.summary ?? null,
        architecture: content.architecture ?? null,
        components: content.components ?? [],
        advantages: content.advantages ?? [],
        disadvantages: content.disadvantages ?? [],
        risks: content.risks ?? [],
        costEstimate: content.costEstimate ?? null,
        assumptions: content.assumptions ?? [],
        nextSteps: content.recommendations ?? [],
      }
    : null;

  const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
  const BASIS_TEXT: Record<string, string> = {
    approved_by_human: "APPROVED by a human in CONSYRION AI – implement this.",
    recommended_awaiting_approval: "RECOMMENDED by the council, NOT YET APPROVED by a human – ask the user before implementing.",
    leading_not_approvable:
      "LEADING proposal only – the council could NOT confirm every requirement, it is not approvable. Tell the user what is unconfirmed before implementing.",
  };
  const markdown = chosen
    ? [
        `# CONSYRION AI decision: ${view.project.name}`,
        "",
        `**Status:** ${BASIS_TEXT[chosen.basis!]}`,
        approval ? `**Human decision:** ${approval.action}${approval.comment ? ` – ${approval.comment}` : ""}` : "",
        "",
        `## Proposal ${chosen.label}: ${chosen.title ?? ""}`,
        chosen.summary ?? "",
        "",
        "### Architecture",
        chosen.architecture ?? "",
        ...(chosen.components.length ? ["", "### Components", list(chosen.components)] : []),
        "",
        "### Hard requirements (must hold)",
        list(requirements.map((r) => `${r.id} [${r.status}] ${r.text}`)) || "- none",
        ...(chosen.risks.length ? ["", "### Risks and mitigations", list(chosen.risks.map((r) => `(${r.severity}) ${r.risk} → ${r.mitigation}`))] : []),
        ...(objections.length ? ["", "### Open objections to address", list(objections.map((o) => `(${o.severity}/${o.category}) ${o.claim}`))] : []),
        ...(chosen.assumptions.length ? ["", "### Assumptions to verify", list(chosen.assumptions)] : []),
        ...(chosen.nextSteps.length ? ["", "### Next steps", list(chosen.nextSteps)] : []),
      ]
        .filter((line) => line !== null)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
    : `# CONSYRION AI decision: ${view.project.name}\n\nNo verdict yet (status ${view.session.status}).`;

  return { chosen, requirements, objections, implementationBrief: markdown };
}
