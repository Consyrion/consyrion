import {
  architectureChange,
  awaitingReviewWithoutApproval,
  independenceKey,
  COUNCIL_PHASE_LABELS,
  DECISION_MODE_LABELS,
  dedupeStatements,
  describeConfidenceIssue,
  describeObjection,
  objectionStatusText,
  requirementVerification,
  splitObjections,
  type ConfidenceIssue,
  type VerdictResult,
  councilPurpose,
  ideaCheck,
  type IdeaCheckMatrix,
} from "@consyrium/core";
import { decisionStatusOf } from "./decision-format";
import type { ProposalContent } from "./schemas";
import { confidenceIssueText, objectionDecisionText } from "./report-engine-text";
import { reportNumber, reportTranslator, type ReportLocale, type ReportT } from "./report-i18n";
import type { SessionView } from "./service";

const OUTCOME_TEXT: Record<string, string> = {
  recommended: "A solution is recommended.",
  no_qualifying_solution: "No solution meets the requirements and gates.",
  tie: "Tie – the leading solutions are too close to call; a human must choose.",
  insufficient_evidence: "Insufficient independent evidence for a decision.",
};

/** A confidence issue with every proposal id replaced by its label (A, B, …) – stored in the report snapshot. */
function labelIssue(issue: ConfidenceIssue, label: (proposalId: string) => string): ConfidenceIssue {
  switch (issue.kind) {
    case "missing_evaluators":
    case "single_evaluator":
    case "requirements_disputed":
    case "evaluation_rejected":
    case "undefended_proposal":
      return { ...issue, proposalId: label(issue.proposalId) };
    case "vote_disagrees":
      return { ...issue, majorityVoteWinnerId: label(issue.majorityVoteWinnerId) };
    case "conflict_of_interest":
      return { ...issue, proposalId: label(issue.proposalId), blockedProposalId: label(issue.blockedProposalId) };
    case "weighting_changed_winner":
      return {
        ...issue,
        weightedWinnerId: issue.weightedWinnerId ? label(issue.weightedWinnerId) : null,
        unweightedWinnerId: issue.unweightedWinnerId ? label(issue.unweightedWinnerId) : null,
      };
    default:
      return issue;
  }
}

/** Outcome text when every proposal is a finding that the hard requirements conflict (#121). */
const CONFLICT_TEXT =
  "No solution can meet these requirements: the council found that the hard requirements conflict. The finding can be confirmed; nothing can be built under these requirements – changed requirements need a new council and a new approval.";

/**
 * Final Decision Report, built only from stored session data (no new model output), so it is
 * reproducible and contains exactly what the council produced.
 */

/** R2-01 (night test 08.11.26): the German report showed "Status: awaiting_approval" and "Proposal 1: qualified". */
const STATUS_LABELS: Record<string, string> = {
  queued: "queued",
  running: "running",
  cancel_requested: "cancellation requested",
  cancelled: "cancelled",
  failed: "failed",
  awaiting_approval: "awaiting approval",
  approved: "approved",
  rejected: "rejected",
  changes_requested: "changes requested",
};
const FEASIBILITY_LABELS: Record<string, string> = {
  qualified: "meets all requirements",
  needs_verification: "needs verification",
  fail: "misses a requirement",
  incomplete: "incomplete",
};
const statusLabel = (status: string) => STATUS_LABELS[status] ?? status.replaceAll("_", " ");
const feasibilityLabel = (feasibility: string) => FEASIBILITY_LABELS[feasibility] ?? feasibility.replaceAll("_", " ");

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
    /**
     * #477 / #268: workflow and approval status as the session header shows them – "awaiting_review" plus
     * "no_approvable_proposal" while the workflow waits for a human but nothing can be approved.
     */
    workflowStatus: awaitingReviewWithoutApproval(view.session.status, status) ? ("awaiting_review" as const) : view.session.status,
    approvalStatus: awaitingReviewWithoutApproval(view.session.status, status) ? ("no_approvable_proposal" as const) : null,
    /**
     * #597: the idea-check reading of a verdict nothing can be approved in – only for councils started with the purpose
     * "idea_check", from the same derivation as the verdict screen (`ideaCheck`). Never an approval.
     */
    ideaCheck: ideaReading(view, awaitingReviewWithoutApproval(view.session.status, status), label),
    briefVersion: view.brief.version,
    /** The requirement list the user confirmed for this run (#190); null for runs before it. */
    confirmedRequirements: view.requirementList
      ? {
          version: view.requirementList.version,
          items: view.requirementList.items.map((i): { id: string; text: string; buildCheck?: true; measurementCheck?: true } => {
            // #249 part 2: how this run checked the requirement (its gate version decides, never the list alone).
            const verification = requirementVerification(i, view.session.gateVersion);
            return {
              id: i.id,
              text: i.text,
              ...(verification === "build" ? { buildCheck: true as const } : verification === "measurement" ? { measurementCheck: true as const } : {}),
            };
          }),
          excluded: view.requirementList.excluded.map((e) => ({ text: e.text, reason: e.reason })),
        }
      : null,
    // Vote weights fixed at the start, with the catalog suggestion they came from (#140).
    participants: view.participants.map((p, _i, all) => ({
      model: `${p.provider}/${p.modelId}`,
      /**
       * User decision 08.11.26: instances of one model (other keys) are ONE independent voice. 1-based number of this
       * instance within its group and the group size; null for a model that takes part once.
       */
      instance: (() => {
        const group = all.filter((x) => independenceKey(x.provider, x.modelId) === independenceKey(p.provider, p.modelId));
        return group.length > 1 ? { index: group.indexOf(p) + 1, of: group.length } : null;
      })(),
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
                proposals: Array<{ proposalId: string; feasibility: string; causes: string[]; limitedReview?: boolean; architectureCandidate?: boolean }>;
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
              // #249 part 2: an architecture candidate is named as such – the measurement is still open.
              const feasibility = g.limitedReview
                ? "provisional favourite (limited review)"
                : g.architectureCandidate
                  ? "architecture candidate (performance proof open)"
                  : g.feasibility;
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
      const gate = (
        matrix as {
          requirementGate?: {
            proposals: Array<{
              proposalId: string;
              requirements: Array<{
                requirementId: string;
                status: string;
                pass: string[];
                fail: string[];
                unknown: string[];
                open: string[];
                buildVerification?: boolean;
                measurementPending?: boolean;
              }>;
            }>;
          };
        } | null
      )?.requirementGate;
      const items = view.requirementList?.items ?? [];
      if (!gate || !items.length) return null;
      return {
        requirements: items.map((item, index) => ({ id: `R${index + 1}`, text: item.text })),
        proposals: gate.proposals.map((g) => ({
          proposal: label(g.proposalId),
          cells: items.map((item) => {
            const req = g.requirements.find((r) => r.requirementId === item.id);
            return req
              ? {
                  // Night test R4 (ChatGPT): a confirmed verification plan is not a met requirement – its own status.
                  // #249 part 2: a confirmed measurement plan is not a met requirement either.
                  status:
                    req.buildVerification && req.status === "PASS"
                      ? "PLAN_CONFIRMED"
                      : req.measurementPending && req.status === "PASS"
                        ? "MEASUREMENT_PLAN"
                        : req.status,
                  met: req.pass.length,
                  expected: req.pass.length + req.fail.length + req.unknown.length + req.open.length,
                }
              : { status: "UNKNOWN", met: 0, expected: 0 };
          }),
        })),
      };
    })(),
    /** Proposals the server allows to be approved (#181); everything else is shown as not approvable. */
    approvableProposals: (status?.approvableProposalIds ?? []).map((id) => label(id)),
    /** #249 part 2: the latest favourite / prototype mark of this verdict – a human action, never the verdict. */
    humanMark: (() => {
      const mark = (view as { humanMark?: { kind: "favorite" | "prototype_build"; proposalId: string } | null }).humanMark;
      return mark ? { kind: mark.kind, proposal: label(mark.proposalId) } : null;
    })(),
    /** #511: architecture candidates a human may mark as favourite or build as a prototype / measurement build. */
    prototypeProposals: ((status as { prototypeProposalIds?: string[] } | null)?.prototypeProposalIds ?? []).map((id) => label(id)),
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
          formula: matrix.formula?.replace(/"(par_[0-9a-f]+)"/g, (id, participantId: string) =>
            view.participants.some((x) => x.id === participantId) ? `"${modelOf(participantId)}"` : id,
          ),
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
          /** The same issues with proposal ids replaced by labels, so the report can word them in its language (08.11.26). */
          confidenceIssueData: (matrix.confidenceIssues ?? []).map((issue) => labelIssue(issue, label)),
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
    /** Every proposal with what it is (Telegram live test 08.11.26: the PDF named "Proposal A/B/C" but never said what they were). */
    /** Skill the council was set up with (#363): name, version and content hash – never its knowledge text. */
    /** Context documents of the run (night test R4: MCP files were not visible in the report) – names only. */
    contextDocuments: view.requirementList?.documents ?? [],
    skill: view.session.skill
      ? { id: view.session.skill.skillId, name: view.session.skill.name, version: view.session.skill.version, contentHash: view.session.skill.contentHash }
      : null,
    proposalOverview: [...view.proposals]
      .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""))
      .map((p) => {
        const content = latest(p.id)?.content as ProposalContent | undefined;
        return { label: p.label, kind: p.kind, title: content?.title ?? null, summary: content?.summary ?? null, author: modelOf(p.authorParticipantId) };
      }),
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
function objectionLine(o: DecisionReport["objections"][number], t: ReportT, locale: ReportLocale = "en") {
  const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
  if (t("Proposal") === "Proposal") return describeObjection(o);
  return [
    t("Objection by {by} against Proposal {proposal}: {claim}", { by: o.raisedBy, proposal: o.proposal, claim: collapse(o.claim) }),
    o.evidence ? t(" Reasoning: {text}", { text: collapse(o.evidence) }) : "",
    ` – ${t(objectionStatusText(o.status))}`,
    o.resolution ? ` (${objectionDecisionText(collapse(o.resolution), locale)})` : "",
    o.blocking ? t(" – blocks approval") : "",
  ].join("");
}

/** The Markdown report; fixed wording in `locale` (#322), model output as written. Default English. */
/**
 * Telegram live test 08.11.26: the German report printed the engine's English gate causes and summary. The known
 * sentences are rebuilt from report-i18n templates (English stays exactly as the engine wrote it); others stay as sent.
 */
const GATE_TEXT: ReadonlyArray<readonly [RegExp, string, (m: RegExpExecArray) => Record<string, string | number>]> = [
  [
    /^(\S+) not met according to (\d+) of (\d+) evaluators \(model judgement\)\.$/,
    "{id} not met according to {k} of {n} evaluators (model judgement).",
    (m) => ({ id: m[1]!, k: m[2]!, n: m[3]! }),
  ],
  [
    /^(\S+) disputed: (\d+) of (\d+) evaluators confirm it, (\d+) found it not met\.$/,
    "{id} disputed: {pass} of {n} evaluators confirm it, {fail} found it not met.",
    (m) => ({ id: m[1]!, pass: m[2]!, n: m[3]!, fail: m[4]! }),
  ],
  [
    /^(\S+) not confirmed: (\d+) of (\d+) evaluators could not confirm it\.$/,
    "{id} not confirmed: {k} of {n} evaluators could not confirm it.",
    (m) => ({ id: m[1]!, k: m[2]!, n: m[3]! }),
  ],
  [
    /^(\S+) not confirmed: (\d+) of (\d+) evaluators gave no valid answer\.$/,
    "{id} not confirmed: {k} of {n} evaluators gave no valid answer.",
    (m) => ({ id: m[1]!, k: m[2]!, n: m[3]! }),
  ],
  [
    /^Architecture candidate – performance proof open: ([A-Z]\d+(?:, [A-Z]\d+)*) can only be confirmed by measuring the running implementation; the evaluators confirmed the measurement plan, not the requirement\.$/,
    "Architecture candidate – performance proof open: {ids} can only be confirmed by measuring the running implementation; the evaluators confirmed the measurement plan, not the requirement.",
    (m) => ({ ids: m[1]! }),
  ],
  [
    // #511 (decision-format architectureCandidateText): the reason of a verdict with an architecture candidate.
    /^Architecture candidate – performance proof open: ([A-Z]\d+(?:, [A-Z]\d+)*) can only be confirmed by measuring the running implementation\. The council confirmed the measurement plan, not the requirement, so no proposal can be approved as a finished solution yet\. Mark it as favourite, approve a prototype \/ measurement build or record the measured result\.$/,
    "Architecture candidate – performance proof open: {ids} can only be confirmed by measuring the running implementation. The council confirmed the measurement plan, not the requirement, so no proposal can be approved as a finished solution yet. Mark it as favourite, approve a prototype / measurement build or record the measured result.",
    (m) => ({ ids: m[1]! }),
  ],
  [
    /^None of the evaluated proposals meets all confirmed requirements according to these evaluations\.$/,
    "None of the evaluated proposals meets all confirmed requirements according to these evaluations.",
    () => ({}),
  ],
];
function gateText(text: string, t: ReportT): string {
  // Prefixes the server puts in front of a gate cause ("Other gate: Not qualified: R2 not confirmed: …").
  const prefixed = /^(Other gate|Not qualified): (.+)$/.exec(text);
  if (prefixed) return t(prefixed[1] === "Other gate" ? "Other gate: {cause}" : "Not qualified: {cause}", { cause: gateText(prefixed[2]!, t) });
  for (const [re, template, values] of GATE_TEXT) {
    const m = re.exec(text);
    if (m) return t(template, values(m));
  }
  return text;
}

/** Criterion keys as the report names them (Confluence test 09.11.26: "technicalQuality 9/10" stood in the page). */
const CRITERION_NAMES: Record<string, string> = {
  technicalQuality: "Technical quality",
  security: "Security",
  maintainability: "Maintainability",
  operatingCost: "Operating cost",
  implementationSpeed: "Speed",
};

/**
 * The stored formula ("total = Σ vote-weighted mean_independent_score(criterion) × weight(criterion) / 100; weights
 * {…}; evaluator vote weights {…}") read as a sentence with criterion names; unknown shapes stay as stored.
 */
function readableFormula(formula: string, t: ReportT): string {
  const m =
    /^total = Σ (vote-weighted )?mean_independent_score\(criterion\) × weight\(criterion\) \/ 100; weights (\{[^}]*\})(?:; evaluator vote weights (\{[^}]*\}))?$/.exec(
      formula,
    );
  if (!m) return formula;
  try {
    const weights = Object.entries(JSON.parse(m[2]!) as Record<string, number>)
      .map(([k, v]) => `${t(CRITERION_NAMES[k] ?? k)} ${v} %`)
      .join(", ");
    const votes = m[3]
      ? Object.entries(JSON.parse(m[3]) as Record<string, number>)
          .map(([k, v]) => `${k} ${v}/10`)
          .join(", ")
      : "";
    return t(
      m[1]
        ? "total = sum over all criteria of the vote-weighted average of the independent scores × weight / 100; weights: {weights}; vote weights: {votes}"
        : "total = sum over all criteria of the average of the independent scores × weight / 100; weights: {weights}",
      { weights, votes },
    );
  } catch {
    return formula;
  }
}

/** Human decisions as words (Confluence live test 09.11.26: "approve:" under "Menschliche Entscheidungen"). */
/** The human decision in words ("changes requested"), translated – never the raw action id in a report. */
export function approvalActionText(action: string, t: ReportT): string {
  return t(APPROVAL_ACTION[action] ?? action);
}

const APPROVAL_ACTION: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  request_more_debate: "more debate requested",
  request_changes: "changes requested",
  select_alternative: "alternative selected",
  repeat_evaluation: "evaluation repeated",
  // #249 part 2: human marks and acceptance by measurement.
  mark_favorite: "marked as favourite",
  approve_prototype: "prototype/measurement build approved",
  approve_after_measurement: "approved after measurement",
};

/**
 * The risk lines the report builds in English ("… (low; mitigation: …)", "… (accepted objection)", "… – raised against
 * v1; no longer applies to v2 (not independently re-reviewed)") in the report language; the model's words stay.
 */
function riskText(text: string, t: ReportT): string {
  const mitigation = /^([\s\S]*) \((low|medium|high|critical); mitigation: ([\s\S]*)\)$/.exec(text);
  if (mitigation) return t("{risk} ({severity}; mitigation: {mitigation})", { risk: mitigation[1]!, severity: t(mitigation[2]!), mitigation: mitigation[3]! });
  const objection = /^([\s\S]*) \((\w+) objection\)$/.exec(text);
  if (objection) return t("{claim} ({status})", { claim: objection[1]!, status: t(objectionStatusText(objection[2]! as never)) });
  const moot = /^([\s\S]*) – raised against v(\d+); no longer applies to v(\d+) \(not independently re-reviewed\)$/.exec(text);
  if (moot)
    return t("{claim} – raised against v{from}; no longer applies to v{to} (not independently re-reviewed)", { claim: moot[1]!, from: moot[2]!, to: moot[3]! });
  return text;
}

/** Debate entry types, roles, objection areas and consensus states as words, not raw values (ChatGPT review 08.11.26). */
const DEBATE_KIND: Record<string, string> = {
  question: "question",
  answer: "answer",
  critique: "critique",
  rebuttal: "rebuttal",
  moderator: "moderator",
  role_failed: "role review failed",
};
const debateKind = (kind: string) => DEBATE_KIND[kind] ?? kind.replaceAll("_", " ");
/** "security_expert" → "security expert": the English report gets words too; other languages translate them. */
const roleLabel = (role: string) => role.replaceAll("_", " ");
const SEVERITY_WORD: Record<string, string> = { low: "low", medium: "medium", high: "high", critical: "critical" };
/** "security/medium" stays as it is in English (unchanged report); other languages get "Sicherheit · Schwere mittel". */
function categoryLabel(category: string | null | undefined, severity: string, t: ReportT) {
  if (t("Proposal") === "Proposal") return `${category ?? ""}/${severity}`;
  const sev = t("{level} severity", { level: t(SEVERITY_WORD[severity] ?? severity) });
  return category ? `${t(category)} · ${sev}` : sev;
}
const CONSENSUS_STATUS: Record<string, string> = { consensus: "consensus reached", partial: "partial consensus", no_consensus: "no consensus" };

/** Confidence issues in the report language; reports from before `confidenceIssueData` keep the engine's sentences. */
function issueLines(m: NonNullable<DecisionReport["evaluationMatrix"]>, locale: ReportLocale, t: ReportT): string[] {
  const data = m.confidenceIssueData;
  const english = m.confidenceIssues ?? [];
  if (!data || data.length !== english.length) return english.map((i) => gateText(i, t));
  return data.map((issue, i) => confidenceIssueText(issue, locale, english[i]!));
}

/** Labels of proposals that passed the requirement check (matrix "eligible"), best total first. */
export function eligibleProposals(report: DecisionReport): string[] {
  return [...(report.evaluationMatrix?.proposals ?? [])]
    .filter((p) => p.eligible)
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1))
    .map((p) => p.label);
}

/**
 * What the reader has to do now – one sentence, derived only from stored state (the server's approvable set, the
 * outcome and the latest human decision), never a new judgement (ChatGPT review 08.11.26: "Next steps: none" on an
 * open verdict left the reader stuck). Shown on the PDF summary and when the recommended proposal names no steps.
 */
export function nextAction(report: DecisionReport, t: ReportT): string {
  // Stored snapshots from before a field existed may lack it; read every list defensively.
  const last = (report.approvals ?? []).at(-1)?.action;
  if (last === "approve" || report.status === "approved") return t("Approved – the build can be started in the app.");
  if (report.status === "rejected") return t("Rejected – start a new council with a changed brief if the question is still open.");
  if (report.requirementsConflict) return t("Change the conflicting requirements and start a new council – nothing can be built under these requirements.");
  const approvable = report.approvableProposals ?? [];
  const recommended = report.decisionFormat?.approvable !== false ? report.recommendedSolution?.label : null;
  if (recommended && approvable.includes(recommended))
    return t("Check Proposal {label} and approve it in the app – nothing is built before a human approves.", { label: recommended });
  if (approvable.length)
    return t("Choose one of the approvable proposals in the app: {list}. The council left this choice to a human.", { list: joinLabels(approvable, t) });
  // Gesamttest 08.11.26: after the human mark the step moves on, as on the verdict screen (verdictStatus.initialAction).
  if (report.humanMark?.kind === "favorite")
    return t(
      "Proposal {label} is your favourite: approve a prototype / measurement build in the app or record the measured result – nothing is approved as a finished solution.",
      { label: report.humanMark.proposal },
    );
  if (report.humanMark?.kind === "prototype_build")
    return t(
      "A prototype / measurement build of Proposal {label} is approved: record the measured result in the app – only a met measurement allows the approval after measurement.",
      { label: report.humanMark.proposal },
    );
  // #511: same trigger as the verdict screen's first step (decisionStatus.prototypeProposalIds → "mark_favorite").
  const prototypes = report.prototypeProposals ?? [];
  if (prototypes.length)
    return t(
      prototypes.length === 1
        ? "Proposal {label} is an architecture candidate: mark it as favourite, approve a prototype / measurement build or record the measured result in the app – nothing is approved as a finished solution."
        : "Proposals {labels} are architecture candidates: mark one as favourite, approve a prototype / measurement build or record the measured result in the app – nothing is approved as a finished solution.",
      { label: prototypes[0]!, labels: joinLabels(prototypes, t) },
    );
  const eligible = eligibleProposals(report);
  if (eligible.length)
    return t(
      eligible.length === 1
        ? "Nothing can be approved in this council. Proposal {label} passed the requirement check – clear the open points below (objections, unconfirmed checks) and start a new council."
        : "Nothing can be approved in this council. Proposals {labels} passed the requirement check – clear the open points below (objections, unconfirmed checks) and start a new council.",
      { label: eligible[0]!, labels: joinLabels(eligible, t) },
    );
  return t("No proposal meets all confirmed requirements. Change the brief or the requirements and start a new council.");
}
const joinLabels = (labels: string[], t: ReportT) => (labels.length < 2 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} ${t("and")} ${labels.at(-1)}`);

const NEEDS_VERIFICATION = "Needs verification – the council could not confirm that a proposal meets every requirement. It cannot be approved or built.";
/**
 * The outcome sentence for the reader. The engine's "could not confirm that a proposal meets every requirement" is
 * wrong when proposals did pass and something else stopped the recommendation (ChatGPT review 08.11.26) – then the
 * neutral wording is used and `blockedExplanation` says why.
 */
export function outcomeLine(report: DecisionReport, locale: ReportLocale, t: ReportT): string {
  if (report.outcomeText === NEEDS_VERIFICATION && blockedExplanation(report, locale, t))
    return t("Needs verification – there is no automatic recommendation, and nothing in this council can be approved or built.");
  // A reason with values (requirement ids) is matched first, so it is translated like every gate text.
  const withValues = gateText(report.outcomeText, t);
  return withValues !== report.outcomeText ? withValues : t(report.outcomeText);
}

/**
 * Why nothing is recommended although proposals passed the requirement check (ChatGPT review 08.11.26: page 1 said
 * "not approvable" for all while the matrix said "eligible: yes" for A and C). Null when there is nothing to explain.
 */
export function blockedExplanation(report: DecisionReport, locale: ReportLocale, t: ReportT): string | null {
  if (report.decisionFormat?.approvable !== false && report.recommendedSolution) return null;
  const eligible = eligibleProposals(report).filter((l) => !(report.approvableProposals ?? []).includes(l));
  if (!eligible.length || !report.evaluationMatrix) return null;
  const reasons = issueLines(report.evaluationMatrix, locale, t);
  return [
    t(eligible.length === 1 ? "Proposal {label} passed the requirement check." : "Proposals {labels} passed the requirement check.", {
      label: eligible[0]!,
      labels: joinLabels(eligible, t),
    }),
    reasons.length ? t("No automatic recommendation: {reasons}.", { reasons: reasons.join("; ").replace(/\.$/, "") }) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function reportToMarkdown(report: DecisionReport, locale: ReportLocale = "en"): string {
  const t = reportTranslator(locale);
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${t("none")}`);
  const r = report.recommendedSolution;
  const m = report.evaluationMatrix;
  const lines = [
    `# ${t("Final Decision Report – {project}", { project: report.project })}`,
    "",
    t("Mode: {mode} · Brief version {version} · Status: {status}", {
      mode: report.mode,
      version: report.briefVersion,
      status: report.approvalStatus
        ? report.ideaCheck && report.ideaCheck.kind !== "none"
          ? t("awaiting your review · idea checked")
          : t("awaiting your review · no approvable proposal")
        : t(statusLabel(report.status)),
    }),
    t("Participants: {list}", {
      list: report.participants
        .map(
          (p) =>
            `${p.model}${p.instance ? t(" (instance {index} of {of} – one independent voice)", { index: p.instance.index, of: p.instance.of }) : ""}${p.status === "failed" ? t(" (failed)") : ""}`,
        )
        .join(", "),
    }),
    t("Vote weights: {list}", {
      list: report.participants
        .map(
          (p) =>
            `${p.model} ${p.voteWeight}/10${p.suggestedWeight !== null && p.suggestedWeight !== p.voteWeight ? t(" (suggested {n})", { n: p.suggestedWeight }) : ""}`,
        )
        .join(", "),
    }),
    ...(report.validParticipation?.percent != null ? [t("Valid participation: {line}", { line: participationLine(report.validParticipation, t) })] : []),
    ...(report.skill
      ? [
          t("Skill: {name} (version {version}, hash {hash})", {
            name: report.skill.name,
            version: report.skill.version,
            hash: report.skill.contentHash.slice(0, 12),
          }),
        ]
      : []),
    ...(report.contextDocuments?.length
      ? [t("Context documents (read as untrusted data, never requirements): {names}", { names: report.contextDocuments.join(", ") })]
      : []),
    "",
    `## ${t("Outcome")}`,
    outcomeLine(report, locale, t),
    "",
    ...ideaLines(report.ideaCheck, t),
    ...(report.proposalOverview.length
      ? [
          `### ${t("The proposals")}`,
          list(
            report.proposalOverview.map(
              (p) =>
                `**${t("Proposal {label}", { label: p.label ?? "?" })}${p.kind === "hybrid" ? t(" (hybrid)") : ""}** – ${p.title ?? ""}${p.author ? ` (${p.author})` : ""}${p.summary ? `: ${p.summary}` : ""}`,
            ),
          ),
          "",
        ]
      : []),
    ...(report.decisionFormat && !report.decisionFormat.approvable ? [t("**Not approvable:** this verdict cannot be approved or built."), ""] : []),
    ...(blockedExplanation(report, locale, t) ? [blockedExplanation(report, locale, t)!, ""] : []),
    `**${t("What you need to do now")}:** ${nextAction(report, t)}`,
    "",
    ...(report.requirementsConflict && report.requirementConflicts.length
      ? [`### ${t("Conflicting requirements")}`, list(report.requirementConflicts), ""]
      : []),
    ...(report.requirementGate
      ? [
          `### ${t("Requirement check (model judgements with reasons, not a fact check)")}`,
          ...(report.requirementGate.summary ? [gateText(report.requirementGate.summary, t)] : []),
          ...(report.requirementGate.comparisonNote ? [report.requirementGate.comparisonNote] : []),
          list(
            report.requirementGate.proposals.map(
              (g) =>
                `${t("Proposal {label}", { label: g.proposal })}: ${t(feasibilityLabel(g.feasibility))}${g.causes.length ? ` – ${g.causes.map((c) => gateText(c, t)).join(" ")}` : ""}`,
            ),
          ),
          "",
        ]
      : []),
    ...(report.confirmedRequirements
      ? [
          `## ${t("Confirmed requirements (list version {version})", { version: report.confirmedRequirements.version })}`,
          // Night test R4: a build check is never shown as verified – the build proves it after implementation.
          list(
            report.confirmedRequirements.items.map(
              (i) =>
                `${i.id}: ${i.text}${
                  i.buildCheck
                    ? ` (${t("build check – verified after implementation, not by this council")})`
                    : i.measurementCheck
                      ? ` (${t("measurement check – only measuring the running implementation confirms it, not this council")})`
                      : ""
                }`,
            ),
          ),
          ...(report.confirmedRequirements.excluded.length
            ? ["", t("Not taken over:"), list(report.confirmedRequirements.excluded.map((e) => `${e.text} (${t(e.reason)})`))]
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
      list(r.rationale.map((x) => `${t(CRITERION_NAMES[x.criterion] ?? x.criterion)} ${x.score}/10 (${x.evaluator}): ${x.rationale}`)),
      "",
    );
  }
  if (m) {
    lines.push(
      `## ${t("Evaluation matrix")}`,
      t("Formula: {formula}", { formula: readableFormula(m.formula, t) }),
      "",
      `| ${t("Proposal")} | ${t("Total")} | ${t("Implementable")} | ${t("Eligible")} | ${t("Evaluators")} | Borda | ${t("Notes")} |`,
      "|---|---|---|---|---|---|---|",
    );
    for (const p of m.proposals)
      lines.push(
        `| ${p.label} | ${p.total ?? "–"} | ${t(p.implementable ? "yes" : "no")} | ${t(p.eligible ? "yes" : "no")} | ${p.independentEvaluators} | ${p.bordaPoints} | ${p.ineligibleReasons.map((r) => gateText(r, t)).join("; ")} |`,
      );
    lines.push(
      "",
      t("Majority vote (for information only – it never overrides the requirement check): {winner}", {
        winner: m.majorityVoteWinner ?? t("no clear majority"),
      }),
      "",
    );
    const issues = issueLines(m, locale, t);
    if (m.confidence === "low")
      lines.push(t("**Low confidence:**"), list([...m.failedEvaluators.map((f) => t("Evaluation failed – {name}", { name: f })), ...issues]), "");
    if (m.confidence === "reduced") lines.push(t("**Limited review depth:**"), list(issues), "");
  }
  if (report.debate.length) {
    lines.push(`## ${t("Debate")}`, "");
    for (const m of report.debate) {
      const meta = [
        m.phase,
        t("round {n}", { n: m.round }),
        // English keeps the stored values as before; other languages get words.
        m.kind ? (locale === "en" ? m.kind : t(debateKind(m.kind))) : null,
        m.role ? (locale === "en" ? m.role : t(roleLabel(m.role))) : null,
        m.proposal ? t("Proposal {label}", { label: m.proposal }) : null,
        m.severity ? categoryLabel(m.category, m.severity, t) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(
        `- **${m.by}** (${meta}): ${m.text.replace(/\s+/g, " ").trim()}${m.evidence ? ` _${t("Evidence")}:_ ${m.evidence.replace(/\s+/g, " ").trim()}` : ""}`,
      );
    }
    lines.push("");
  }
  lines.push(`## ${t("Remaining risks")}`, list(report.remainingRisks.map((r) => (locale === "en" ? r : riskText(r, t)))), "");
  if (report.mootObjections.length)
    lines.push(`### ${t("No longer applicable after the revision")}`, list(report.mootObjections.map((r) => (locale === "en" ? r : riskText(r, t)))), "");
  // Objections, not minority opinions (#169): the status says how the objection was decided, not the proposal.
  lines.push(`## ${t("Objections (Minority Review)")}`);
  lines.push(
    report.objections.length
      ? report.objections
          .map(
            (o) =>
              `- ${objectionLine(o, t, locale)} [${categoryLabel(o.category, o.severity, t)}]${o.undefended ? ` – ${t("NOT DEFENDED")} – ${o.undefended}` : ""}`,
          )
          .join("\n")
      : `- ${t("none")}`,
  );
  if (report.consensus?.disagreements.length) lines.push("", t("Disagreements that remain between the models are listed under Consensus Round."));
  lines.push(
    "",
    `## ${t("Alternatives not chosen")}`,
    list(
      report.alternatives.map(
        (a) => `${t("Proposal {label}", { label: a.label ?? "?" })}${a.kind === "hybrid" ? t(" (hybrid)") : ""}: ${a.title ?? ""} – ${a.summary ?? ""}`,
      ),
    ),
    "",
    `## ${t("Next steps")}`,
    list(report.nextSteps.length ? report.nextSteps : [nextAction(report, t)]),
    "",
  );
  if (report.consensus)
    lines.push(
      "## Consensus Round",
      t("Status: {status}", { status: locale === "en" ? report.consensus.status : t(CONSENSUS_STATUS[report.consensus.status] ?? report.consensus.status) }),
      ...(report.consensus.basedOn.length ? [t("Based on: {list}", { list: report.consensus.basedOn.join(", ") })] : []),
      t("Agreements:"),
      list(report.consensus.agreements),
      t("Disagreements:"),
      list(report.consensus.disagreements),
      "",
    );
  lines.push(
    `## ${t("Human decisions")}`,
    list(report.approvals.map((a) => `${locale === "en" ? a.action : t(APPROVAL_ACTION[a.action] ?? a.action)}${a.comment ? `: ${a.comment}` : ""}`)),
    "",
    t("Tokens used: {used} of {budget}", { used: reportNumber(locale, report.tokens.used), budget: reportNumber(locale, report.tokens.budget) }),
  );
  return lines.join("\n");
}

/** #597: the idea-check reading for the report, with proposal labels and requirement numbers instead of ids. */
function ideaReading(view: SessionView, nothingApprovable: boolean, label: (proposalId: string | null) => string) {
  if (!nothingApprovable || councilPurpose(view.session.policy) !== "idea_check") return null;
  const result = ideaCheck(view.decision?.matrix as IdeaCheckMatrix | null | undefined);
  if (!result) return null;
  const items = view.requirementList?.items ?? [];
  const number = (id: string) => {
    const index = items.findIndex((i) => i.id === id);
    return index < 0 ? id : `R${index + 1}`;
  };
  return {
    kind: result.kind,
    leaders: result.leaders.map(label),
    tiedWith: result.tiedWith.map(label),
    toClarify: result.toClarify.map((id) => ({ requirement: number(id), text: items.find((i) => i.id === id)?.text ?? "" })),
    excluded: result.excluded.map((e) => ({ proposal: label(e.proposalId), requirements: e.requirementIds.map(number) })),
  };
}

function ideaLines(idea: ReturnType<typeof ideaReading>, t: ReportT): string[] {
  if (!idea) return [];
  const proposal = (l: string) => t("Proposal {label}", { label: l });
  const lead =
    idea.kind === "none"
      ? t("Every proposal breaks at least one hard requirement. As described, the idea does not work out – change the idea or the requirements.")
      : idea.kind === "several"
        ? t(
            "No evaluator ruled these proposals out, and they are level on score and open points: {list}. The idea holds up – which variant fits better is your call.",
            {
              list: idea.leaders.map(proposal).join(", "),
            },
          )
        : idea.tiedWith.length
          ? t(
              "{proposal} is level on score with {list} but leaves the fewest points open, and no evaluator ruled it out. The idea holds up; some points are not proven yet.",
              {
                proposal: proposal(idea.leaders[0]!),
                list: idea.tiedWith.map(proposal).join(", "),
              },
            )
          : t("No evaluator ruled {proposal} out, and it has the best overall score. The idea holds up; some points are not proven yet.", {
              proposal: proposal(idea.leaders[0]!),
            });
  return [
    `### ${t("Idea check")}`,
    lead,
    ...(idea.toClarify.length
      ? ["", t("Clarify before the next step (not proven yet):"), ...idea.toClarify.map((r) => `- ${r.requirement}${r.text ? ` – ${r.text}` : ""}`)]
      : []),
    ...(idea.excluded.length
      ? [
          "",
          t("Ruled out:"),
          ...idea.excluded.map((e) => `- ${t("{proposal} – not met: {list}", { proposal: proposal(e.proposal), list: e.requirements.join(", ") })}`),
        ]
      : []),
    "",
    t(
      "This is an idea check, not an approval. Nothing is built until the open points are proven and a council with the purpose “Approve a decision” confirms them.",
    ),
    "",
  ];
}
