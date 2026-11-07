"use client";

import type { ConfidenceIssue } from "@consyrion/core/browser";
import { useTranslations } from "next-intl";

/**
 * The council engine stores the fixed parts of an objection decision in English ("Conceded by the author – …",
 * "Addressed by the author in v2.", "Not independently re-reviewed.", "No independent reviewer was available …"),
 * next to the reviewer's own words. Those fixed parts come from a few templates (packages/council/src/phases.ts), so the
 * interface shows them in its language; the model's text (in the brief's language) and anything unknown stays as
 * stored. Same idea as `useVerdictReason` and `useGateText` (night test 07.11.26: German UI, English notes).
 */

type T = (key: string, values?: Record<string, string | number>) => string;

const VERSIONS = String.raw`v\d+(?:, v\d+)*`;
const SAID: ReadonlySet<string> = new Set(["unresolved", "refuted", "resolved", "accepted"]);
/** Canonical phase names stay in English everywhere in the UI (`COUNCIL_PHASES`). */
const phaseName = (phase: string) => phase.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Ordered: longer, more specific fragments first. Each entry rewrites every match in the text. */
function fragments(t: T): ReadonlyArray<readonly [RegExp, (m: string[]) => string]> {
  const said = (word: string) => (SAID.has(word) ? t(`said.${word}`) : word);
  return [
    [/No independent reviewer was available – (.+?) for every eligible judge/g, (m) => t("noJudgeFailed", { reason: m[1]! })],
    [/No independent reviewer was available/g, () => t("noJudge")],
    [/\((\d+) of (\d+) required independent reviews – no further judge was available\)/g, (m) => t("partialReviews", { got: m[1]!, needed: m[2]! })],
    [/Conceded by the author – recorded as accepted until a revision fixes it \(reviewer said: (\w+)\)\./g, (m) => t("conceded", { said: said(m[1]!) })],
    [
      new RegExp(String.raw`Content changed after the author conceded in (${VERSIONS}) \(not linked to this objection\)\.`, "g"),
      (m) => t("changedAfterConcede", { versions: m[1]! }),
    ],
    [new RegExp(String.raw`Addressed by the author in (${VERSIONS})\.`, "g"), (m) => t("addressed", { versions: m[1]! })],
    [/Not independently re-reviewed\./g, () => t("notReReviewed")],
  ];
}

/** Localizes the known fixed parts inside a stored objection decision; everything else is returned unchanged. */
export function localizeEngineText(text: string, t: T): string {
  let out = text;
  for (const [pattern, replace] of fragments(t)) out = out.replace(pattern, (...args: unknown[]) => replace(args.slice(0, -2) as string[]));
  return out;
}

export function useEngineText() {
  const t = useTranslations("engineText") as unknown as T;
  return (text: string | null | undefined) => (text ? localizeEngineText(text, t) : (text ?? null));
}

/** A stored objection decision in the interface language. */
export function EngineText({ text }: { text: string }) {
  const engine = useEngineText();
  return <>{engine(text)}</>;
}

/** The reasons for reduced or low confidence, from the stored structure (`describeConfidenceIssue` is English only). */
export function useConfidenceIssueText() {
  const t = useTranslations("engineText.issue") as unknown as T;
  return (issue: ConfidenceIssue, label: (proposalId: string) => string): string => {
    switch (issue.kind) {
      case "missing_evaluators":
        return t("missing_evaluators", { label: label(issue.proposalId), evaluators: issue.evaluators, expected: issue.expected });
      case "vote_disagrees":
        return t("vote_disagrees", { label: label(issue.majorityVoteWinnerId) });
      case "participant_failed":
        return t("participant_failed", { model: issue.modelId, reason: issue.reason });
      case "unreviewed_objections":
        return t("unreviewed_objections", { count: issue.count });
      case "single_evaluator":
        return t("single_evaluator", { label: label(issue.proposalId) });
      case "requirements_disputed":
        return t("requirements_disputed", { label: label(issue.proposalId), failed: issue.failed, total: issue.total });
      case "insufficient_evaluators":
        return t("insufficient_evaluators", { evaluators: issue.evaluators, expected: issue.expected });
      case "no_debate_contribution":
        return t("no_debate_contribution", { model: issue.modelId });
      case "undefended_proposal":
        return t("undefended_proposal", { label: label(issue.proposalId), reason: issue.reason, count: issue.count });
      case "phase_shortened":
        return t("phase_shortened", { phase: phaseName(issue.phase) });
      case "weighting_changed_winner":
        return issue.unweightedWinnerId
          ? t(issue.weightedWinnerId ? "weighting_changed_winner_both" : "weighting_changed_winner_unweighted", {
              unweighted: label(issue.unweightedWinnerId),
              weighted: issue.weightedWinnerId ? label(issue.weightedWinnerId) : "",
            })
          : t(issue.unweightedOutcome === "tie" ? "weighting_changed_winner_tie" : "weighting_changed_winner_none", {
              weighted: issue.weightedWinnerId ? label(issue.weightedWinnerId) : "–",
            });
      case "comparison_incomplete":
        // A free engine sentence; the gate texts (useGateText) cover its known wording.
        return issue.note;
      case "conflict_of_interest":
        return t("conflict_of_interest", { blocked: label(issue.blockedProposalId), label: label(issue.proposalId) });
      case "evaluation_rejected":
        return t("evaluation_rejected", { label: label(issue.proposalId), count: issue.count });
    }
  };
}
