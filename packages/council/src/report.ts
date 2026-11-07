import {
  architectureChange,
  COUNCIL_PHASE_LABELS,
  DECISION_MODE_LABELS,
  dedupeStatements,
  describeConfidenceIssue,
  describeObjection,
  objectionStatusText,
  splitObjections,
  type VerdictResult,
} from "@consyrion/core";
import { decisionStatusOf } from "./decision-format";
import type { ProposalContent } from "./schemas";
import { reportNumber, reportTranslator, type ReportLocale, type ReportT } from "./report-i18n";
import type { SessionView } from "./service";

const OUTCOME_TEXT: Record<string, string> = {
  recommended: "A solution is recommended.",
  no_qualifying_solution: "No solution meets the requirements and gates.",
  tie: "Tie – the leading solutions are too close to call; a human must choose.",
  insufficient_evidence: "Insufficient independent evidence for a decision.",
};

/** Outcome text when every proposal is a finding that the hard requirements conflict (#121). */
const CONFLICT_TEXT =
  "No solution can meet these requirements: the council found that the hard requirements conflict. The finding can be confirmed; nothing can be built under these requirements – changed requirements need a new council and a new approval.";

/**
 * Final Decision Report, built only from stored session data (no new model output), so it is
 * reproducible and contains exactly what the council produced.
 */
export function buildDecisionReport(view: SessionView) {
  // Format version and approvability as the server computed them (#181, stage 1). A matrix of a format this version
  // does not know is not interpreted; the report then states the neutral reason instead.
  const status =
    view.decisionStatus ??
    (view.decision
      ? decisionStatusOf(
          view.decision,
          view.proposals.map((p) => p.id),
        )
      : null);
  const matrix = (status?.readable ? (view.decision?.matrix ?? null) : null) as
    | (Omit<VerdictResult, "confidence" | "confidenceIssues"> &
        Partial<Pick<VerdictResult, "confidence" | "confidenceIssues">> & {
          weights: Record<string, number>;
          failedEvaluators?: { modelId: string; outcome: string }[];
        })
    | null;
  const latest = (proposalId: string) => {
    const revisions = view.proposals.find((p) => p.id === proposalId)?.revisions ?? [];
    return revisions[revisions.length - 1];
  };
  const label = (proposalId: string | null) => view.proposals.find((p) => p.id === proposalId)?.label ?? "?";
  const modelOf = (participantId: string | null) => {
    const p = view.participants.find((x) => x.id === participantId);
    return p ? `${p.provider}/${p.modelId}` : "unknown";
  };
  const recommended = view.decision?.recommendedProposalId ?? null;
  const recommendedContent = recommended ? (latest(recommended)?.content as ProposalContent | undefined) : undefined;
  const recommendedProposal = view.proposals.find((p) => p.id === recommended);
  // Objections against an earlier revision that the current one no longer contains are not its risks (#150).
  const objectionsOfRecommended = recommendedProposal
    ? splitObjections(
        view.objections.filter((o) => o.proposalId === recommendedProposal.id && (o.status === "accepted" || o.status === "unresolved")),
        recommendedProposal.revisions,
      )
    : { current: [], moot: [] };
  const change =
    recommendedProposal && recommendedProposal.revisions.length > 1
      ? architectureChange(
          recommendedProposal.revisions[0]!.content,
          latest(recommendedProposal.id)?.content,
          view.proposals.filter((p) => p.id !== recommendedProposal.id).map((p) => ({ label: p.label ?? "?", content: p.revisions[0]?.content })),
        )
      : null;
  const scoreRationales = recommended
    ? view.scores
        .filter((s) => s.revisionId === latest(recommended)?.id)
        .map((s) => ({ criterion: s.criterion, score: s.score, rationale: s.rationale, evaluator: modelOf(s.evaluatorParticipantId) }))
    : [];

  return {
    project: view.project.name,
    sessionId: view.session.id,
    mode: DECISION_MODE_LABELS[view.session.mode],
    status: view.session.status,
    briefVersion: view.brief.version,
    /** The requirement list the user confirmed for this run (#190); null for runs before it. */
    confirmedRequirements: view.requirementList
      ? {
          version: view.requirementList.version,
          items: view.requirementList.items.map((i) => ({ id: i.id, text: i.text })),
          excluded: view.requirementList.excluded.map((e) => ({ text: e.text, reason: e.reason })),
        }
      : null,
    // Vote weights fixed at the start, with the catalog suggestion they came from (#140).
    participants: view.participants.map((p) => ({
      model: `${p.provider}/${p.modelId}`,
      status: p.status,
      failureReason: p.failureReason,
      voteWeight: p.voteWeight ?? 1,
      suggestedWeight: (p.voteWeightSuggestion as { tier?: number } | null)?.tier ?? null,
    })),
    /** Valid participation rate (#182): participants with a valid contribution in every phase they were called in. */
    validParticipation: view.participation
      ? {
          valid: view.participation.valid,
          total: view.participation.total,
          percent: view.participation.percent,
          shortfalls: view.participation.shortfalls.map((s) => ({ model: modelOf(s.participantId), phases: s.phases })),
        }
      : null,
    outcome: view.decision?.outcome ?? null,
    outcomeText: !view.decision
      ? "No verdict yet."
      : status && !status.approvable
        ? (status.reason ?? "This verdict cannot be approved or built.")
        : matrix?.requirementsConflict
          ? CONFLICT_TEXT
          : (OUTCOME_TEXT[view.decision.outcome] ?? "This verdict cannot be approved or built."),
    /** Decision format version and whether this verdict can be approved at all (#181); same values as the session view. */
    decisionFormat: status ? { gateVersion: status.gateVersion, approvable: status.approvable, reason: status.reason } : null,
    /**
     * Gate version 2 (#181, S1): feasibility per proposal from the engine's gate, with the causes. Model judgements with
     * reasons, not a fact check; never a claim that the requirements cannot be met together.
     */
    requirementGate: (() => {
      const gate = (
        matrix as
          | {
              requirementGate?: {
                proposals: Array<{ proposalId: string; feasibility: string; causes: string[]; limitedReview?: boolean }>;
                summary: string | null;
                comparisonNote: string | null;
              };
            }
          | undefined
      )?.requirementGate;
      return gate
        ? {
            summary: gate.summary,
            comparisonNote: gate.comparisonNote,
            proposals: gate.proposals.map((g) => {
              const row = matrix?.proposals?.find((p) => p.proposalId === g.proposalId) as { eligible?: boolean; ineligibleReasons?: string[] } | undefined;
              // Requirements confirmed but another gate failed is not the same as unmet requirements (#181 review).
              const otherGate = g.feasibility === "qualified" && row?.eligible === false ? (row.ineligibleReasons ?? []) : [];
              // #249: named as a provisional favourite, not as an open requirement.
              const feasibility = g.limitedReview ? "provisional favourite (limited review)" : g.feasibility;
              return { proposal: label(g.proposalId), feasibility, causes: [...g.causes, ...otherGate.map((r) => `Other gate: ${r}`)] };
            }),
          }
        : null;
    })(),
    /**
     * Requirement × proposal statuses for the summary charts (owner request 05.11.26): the engine's stored gate result,
     * relabelled R1…Rn in the confirmed order; counts only, never recomputed here.
     */
    requirementMatrix: (() => {
      const gate = (matrix as { requirementGate?: { proposals: Array<{ proposalId: string; requirements: Array<{ requirementId: string; status: string; pass: string[]; fail: string[]; unknown: string[]; open: string[] }> }> } } | null)
        ?.requirementGate;
      const items = view.requirementList?.items ?? [];
      if (!gate || !items.length) return null;
      return {
        requirements: items.map((item, index) => ({ id: `R${index + 1}`, text: item.text })),
        proposals: gate.proposals.map((g) => ({
          proposal: label(g.proposalId),
          cells: items.map((item) => {
            const req = g.requirements.find((r) => r.requirementId === item.id);
            return req
              ? { status: req.status, met: req.pass.length, expected: req.pass.length + req.fail.length + req.unknown.length + req.open.length }
              : { status: "UNKNOWN", met: 0, expected: 0 };
          }),
        })),
      };
    })(),
    /** Proposals the server allows to be approved (#181); everything else is shown as not approvable. */
    approvableProposals: (status?.approvableProposalIds ?? []).map((id) => label(id)),
    /** Same status for every client: true means "confirmed finding, no build" (#121). */
    requirementsConflict: matrix?.requirementsConflict ?? false,
    // Several proposals often name the same conflict; exact and normalised duplicates are listed once (#173).
    requirementConflicts: dedupeStatements(view.proposals.flatMap((p) => (latest(p.id)?.content as ProposalContent | undefined)?.requirementConflicts ?? [])),
    recommendedSolution: recommended
      ? {
          label: label(recommended),
          author: modelOf(view.proposals.find((p) => p.id === recommended)?.authorParticipantId ?? null),
          title: recommendedContent?.title,
          summary: recommendedContent?.summary,
          architecture: recommendedContent?.architecture,
          advantages: recommendedContent?.advantages ?? [],
          disadvantages: recommendedContent?.disadvantages ?? [],
          recommendations: recommendedContent?.recommendations ?? [],
          rationale: scoreRationales,
          /** The current revision replaced the solution of the first one (#150); adoptedFrom: proposals it resembles. */
          architectureChange: change?.changed ? { fromVersion: 1, toVersion: latest(recommended!)?.version ?? 1, adoptedFrom: change.adoptedFrom } : null,
        }
      : null,
    evaluationMatrix: matrix
      ? {
          // Participant ids replaced by model names (#181 live test); the stored formula keeps the ids.
          formula: matrix.formula?.replace(/"(par_[0-9a-f]+)"/g, (id, participantId: string) => (view.participants.some((x) => x.id === participantId) ? `"${modelOf(participantId)}"` : id)),
          weights: matrix.weights,
          proposals: (matrix.proposals ?? []).map((p) => ({
            label: label(p.proposalId),
            total: p.total,
            implementable: p.implementable ?? true,
            requirementChecks: p.requirementChecks ?? null,
            eligible: p.eligible,
            ineligibleReasons: p.ineligibleReasons,
            criterionMeans: p.criterionMeans,
            criterionSpread: p.criterionSpread,
            independentEvaluators: p.independentEvaluators,
            bordaPoints: p.bordaPoints,
          })),
          majorityVoteWinner: matrix.majorityVoteWinnerId ? label(matrix.majorityVoteWinnerId) : null,
          tied: (matrix.tiedProposalIds ?? []).map(label),
          confidence: matrix.confidence ?? null,
          confidenceIssues: (matrix.confidenceIssues ?? []).map((issue) => describeConfidenceIssue(issue, label)),
          failedEvaluators: (matrix.failedEvaluators ?? []).map((f) => `${f.modelId}: ${f.outcome}`),
        }
      : null,
    remainingRisks: [
      ...(view.consensus?.outstandingRisks ?? []),
      ...(recommendedContent?.risks ?? []).map((r) => `${r.risk} (${r.severity}; mitigation: ${r.mitigation})`),
      ...objectionsOfRecommended.current.map((o) => `${o.claim} (${o.status} objection)`),
    ],
    /** Objections against an earlier revision whose subject the recommendation no longer contains (#150). */
    mootObjections: objectionsOfRecommended.moot.map(
      (o) => `${o.claim} – raised against v${o.againstVersion}; no longer applies to v${o.currentVersion} (not independently re-reviewed)`,
    ),
    // Full debate transcript (#41): every stored question, answer, critique and rebuttal in order.
    debate: view.messages
      .filter((m) => m.kind !== "comparison" && m.kind !== "preference")
      .map((m) => ({
        phase: COUNCIL_PHASE_LABELS[m.phase],
        round: m.round,
        kind: m.kind,
        by: modelOf(m.participantId),
        role: m.role,
        proposal: m.targetProposalId ? label(m.targetProposalId) : null,
        severity: m.severity,
        category: m.category,
        text: m.body,
        evidence: m.evidence || null,
      })),
    /**
     * Objections of the 12 Minds Council and how the Minority Review decided them (#169). `claim` is the reviewer's
     * own objection; `status` belongs to the objection ("accepted" = the objection is correct), not to the proposal.
     */
    objections: view.objections.map((o) => ({
      proposal: label(o.proposalId),
      raisedBy: modelOf(o.raisedByParticipantId),
      category: o.category,
      severity: o.severity,
      claim: o.claim,
      evidence: o.evidence || null,
      response: o.response,
      /** The author's model failed, so the objection is unanswered – not uncontested (#175). */
      undefended: !o.response && o.undefendedReason ? o.undefendedReason : null,
      status: o.status,
      /** Raised against an earlier revision the current one no longer contains (#150) – not counted as open, as on screen. */
      moot: Boolean(o.moot),
      blocking: o.blocking,
      resolution: o.resolutionReason,
    })),
    consensus: view.consensus
      ? {
          status: view.consensus.status,
          basedOn: view.consensus.basedOn.map((r) => `${r.label} v${r.version}`),
          agreements: view.consensus.agreements,
          disagreements: view.consensus.disagreements,
        }
      : null,
    alternatives: view.proposals
      .filter((p) => p.id !== recommended)
      .map((p) => {
        const content = latest(p.id)?.content as ProposalContent | undefined;
        return { label: p.label, kind: p.kind, title: content?.title, summary: content?.summary, author: modelOf(p.authorParticipantId) };
      }),
    nextSteps: recommendedContent?.recommendations ?? [],
    approvals: view.approvals.map((a) => ({ action: a.action, comment: a.comment, at: a.createdAt })),
    phases: view.stages.map((s) => ({ phase: COUNCIL_PHASE_LABELS[s.phase], status: s.status })),
    tokens: { used: view.session.tokensUsed, budget: view.session.tokenBudget },
  };
}
export type DecisionReport = ReturnType<typeof buildDecisionReport>;

/** "5/6 (83 %); short: google/gemini-x – Open Council" (#182). */
function participationLine(p: NonNullable<DecisionReport["validParticipation"]>, t: ReportT) {
  const short = p.shortfalls.map((s) => `${s.model}${s.phases.length ? ` – ${s.phases.join(", ")}` : ` – ${t("no valid contribution")}`}`);
  return `${p.valid}/${p.total} (${p.percent} %)${short.length ? `; ${t("short: {list}", { list: short.join("; ") })}` : ""}`;
}

/** describeObjection (core) in the report language: who objected against which proposal, why, and how it was decided. */
function objectionLine(o: DecisionReport["objections"][number], t: ReportT) {
  const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
  if (t("Proposal") === "Proposal") return describeObjection(o);
  return [
    t("Objection by {by} against Proposal {proposal}: {claim}", { by: o.raisedBy, proposal: o.proposal, claim: collapse(o.claim) }),
    o.evidence ? t(" Reasoning: {text}", { text: collapse(o.evidence) }) : "",
    ` – ${t(objectionStatusText(o.status))}`,
    o.resolution ? ` (${collapse(o.resolution)})` : "",
    o.blocking ? t(" – blocks approval") : "",
  ].join("");
}

/** The Markdown report; fixed wording in `locale` (#322), model output as written. Default English. */
export function reportToMarkdown(report: DecisionReport, locale: ReportLocale = "en"): string {
  const t = reportTranslator(locale);
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${t("none")}`);
  const r = report.recommendedSolution;
  const m = report.evaluationMatrix;
  const lines = [
    `# ${t("Final Decision Report – {project}", { project: report.project })}`,
    "",
    t("Mode: {mode} · Brief version {version} · Status: {status}", { mode: report.mode, version: report.briefVersion, status: report.status }),
    t("Participants: {list}", { list: report.participants.map((p) => `${p.model}${p.status === "failed" ? t(" (failed)") : ""}`).join(", ") }),
    t("Vote weights: {list}", {
      list: report.participants
        .map((p) => `${p.model} ${p.voteWeight}/10${p.suggestedWeight !== null && p.suggestedWeight !== p.voteWeight ? t(" (suggested {n})", { n: p.suggestedWeight }) : ""}`)
        .join(", "),
    }),
    ...(report.validParticipation?.percent != null ? [t("Valid participation: {line}", { line: participationLine(report.validParticipation, t) })] : []),
    "",
    `## ${t("Outcome")}`,
    t(report.outcomeText),
    "",
    ...(report.decisionFormat && !report.decisionFormat.approvable ? [t("**Not approvable:** this verdict cannot be approved or built."), ""] : []),
    ...(report.requirementsConflict && report.requirementConflicts.length ? [`### ${t("Conflicting requirements")}`, list(report.requirementConflicts), ""] : []),
    ...(report.requirementGate
      ? [
          `### ${t("Requirement check (model judgements with reasons, not a fact check)")}`,
          ...(report.requirementGate.summary ? [report.requirementGate.summary] : []),
          ...(report.requirementGate.comparisonNote ? [report.requirementGate.comparisonNote] : []),
          list(
            report.requirementGate.proposals.map(
              (g) => `${t("Proposal {label}", { label: g.proposal })}: ${g.feasibility.replace("_", " ")}${g.causes.length ? ` – ${g.causes.join(" ")}` : ""}`,
            ),
          ),
          "",
        ]
      : []),
    ...(report.confirmedRequirements
      ? [
          `## ${t("Confirmed requirements (list version {version})", { version: report.confirmedRequirements.version })}`,
          list(report.confirmedRequirements.items.map((i) => `${i.id}: ${i.text}`)),
          ...(report.confirmedRequirements.excluded.length
            ? ["", t("Not taken over:"), list(report.confirmedRequirements.excluded.map((e) => `${e.text} (${e.reason})`))]
            : []),
          "",
        ]
      : []),
  ];
  if (r) {
    const changed = r.architectureChange
      ? [
          `${t("**Architecture change:** revision v{to} replaced the solution of v{from}", { to: r.architectureChange.toVersion, from: r.architectureChange.fromVersion })}${r.architectureChange.adoptedFrom.length ? t("; it resembles Proposal {list}", { list: r.architectureChange.adoptedFrom.join(", ") }) : ""}.`,
          "",
        ]
      : [];
    lines.push(
      `## ${t(report.decisionFormat && !report.decisionFormat.approvable ? "Leading proposal (not approvable)" : "Recommended solution")}: ${t("Proposal {label}", { label: r.label ?? "?" })} – ${r.title ?? ""}`,
      t("Author: {author}", { author: r.author }),
      "",
      ...changed,
      r.summary ?? "",
      "",
      `### ${t("Architecture")}`,
      r.architecture ?? "",
      "",
      `### ${t("Advantages")}`,
      list(r.advantages),
      "",
      `### ${t("Disadvantages")}`,
      list(r.disadvantages),
      "",
      `### ${t("Rationale (independent evaluators)")}`,
      list(r.rationale.map((x) => `${x.criterion} ${x.score}/10 (${x.evaluator}): ${x.rationale}`)),
      "",
    );
  }
  if (m) {
    lines.push(
      `## ${t("Evaluation matrix")}`,
      t("Formula: {formula}", { formula: m.formula }),
      "",
      `| ${t("Proposal")} | ${t("Total")} | ${t("Implementable")} | ${t("Eligible")} | ${t("Evaluators")} | Borda | ${t("Notes")} |`,
      "|---|---|---|---|---|---|---|",
    );
    for (const p of m.proposals)
      lines.push(
        `| ${p.label} | ${p.total ?? "–"} | ${t(p.implementable ? "yes" : "no")} | ${t(p.eligible ? "yes" : "no")} | ${p.independentEvaluators} | ${p.bordaPoints} | ${p.ineligibleReasons.join("; ")} |`,
      );
    lines.push("", t("Majority vote (for information only – it never overrides the requirement check): {winner}", { winner: m.majorityVoteWinner ?? t("no clear majority") }), "");
    if (m.confidence === "low")
      lines.push(t("**Low confidence:**"), list([...m.failedEvaluators.map((f) => t("Evaluation failed – {name}", { name: f })), ...m.confidenceIssues]), "");
    if (m.confidence === "reduced") lines.push(t("**Limited review depth:**"), list(m.confidenceIssues), "");
  }
  if (report.debate.length) {
    lines.push(`## ${t("Debate")}`, "");
    for (const m of report.debate) {
      const meta = [
        m.phase,
        t("round {n}", { n: m.round }),
        m.kind,
        m.role,
        m.proposal ? t("Proposal {label}", { label: m.proposal }) : null,
        m.severity ? `${m.category ?? ""}/${m.severity}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(`- **${m.by}** (${meta}): ${m.text.replace(/\s+/g, " ").trim()}${m.evidence ? ` _${t("Evidence")}:_ ${m.evidence.replace(/\s+/g, " ").trim()}` : ""}`);
    }
    lines.push("");
  }
  lines.push(`## ${t("Remaining risks")}`, list(report.remainingRisks), "");
  if (report.mootObjections.length) lines.push(`### ${t("No longer applicable after the revision")}`, list(report.mootObjections), "");
  // Objections, not minority opinions (#169): the status says how the objection was decided, not the proposal.
  lines.push(`## ${t("Objections (Minority Review)")}`);
  lines.push(
    report.objections.length
      ? report.objections
          .map((o) => `- ${objectionLine(o, t)} [${o.category}/${o.severity}]${o.undefended ? ` – ${t("NOT DEFENDED")} – ${o.undefended}` : ""}`)
          .join("\n")
      : `- ${t("none")}`,
  );
  if (report.consensus?.disagreements.length) lines.push("", t("Disagreements that remain between the models are listed under Consensus Round."));
  lines.push(
    "",
    `## ${t("Alternatives not chosen")}`,
    list(report.alternatives.map((a) => `${t("Proposal {label}", { label: a.label ?? "?" })}${a.kind === "hybrid" ? t(" (hybrid)") : ""}: ${a.title ?? ""} – ${a.summary ?? ""}`)),
    "",
    `## ${t("Next steps")}`,
    list(report.nextSteps),
    "",
  );
  if (report.consensus)
    lines.push(
      "## Consensus Round",
      t("Status: {status}", { status: report.consensus.status }),
      ...(report.consensus.basedOn.length ? [t("Based on: {list}", { list: report.consensus.basedOn.join(", ") })] : []),
      t("Agreements:"),
      list(report.consensus.agreements),
      t("Disagreements:"),
      list(report.consensus.disagreements),
      "",
    );
  lines.push(
    `## ${t("Human decisions")}`,
    list(report.approvals.map((a) => `${a.action}${a.comment ? `: ${a.comment}` : ""}`)),
    "",
    t("Tokens used: {used} of {budget}", { used: reportNumber(locale, report.tokens.used), budget: reportNumber(locale, report.tokens.budget) }),
  );
  return lines.join("\n");
}
