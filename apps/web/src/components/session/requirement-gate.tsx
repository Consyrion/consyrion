"use client";

import { useTranslations } from "next-intl";
import { Badge, Card } from "../ui/surface";
import { modelName, proposalLabel, useGateText, type View } from "./helpers";
import { REQUIREMENT_CELL, requirementCellKey } from "./requirement-status";

/** Shape of the engine's gate result stored in a version-2 matrix (#181, S1); the server computed it, this only shows it. */
export interface GateRequirement {
  requirementId: string;
  status: "PASS" | "FAIL" | "DISPUTED" | "UNKNOWN";
  pass: string[];
  fail: string[];
  unknown: string[];
  open: string[];
  conflicts: string[];
  /** Build check (night test R4): PASS means a verification plan is named; verified after implementation. */
  buildVerification?: boolean;
  /** Measurement check (#249 part 2): PASS means a measurement plan is named; the requirement is open until measured. */
  measurementPending?: boolean;
  /** Measured requirements (engine contract 3): the counted estimate ranges and the limit. */
  estimate?: {
    low: number;
    high: number;
    median: number;
    evaluators: number;
    limit: { direction: "max" | "min"; value: number; unit: string; strict?: boolean };
  } | null;
}

/** The number as given (#226): never rounded or cut across a limit – 99.95 % never "100", 150.004 never "150". */
const fmt = (x: number) => String(Number(x.toPrecision(12)));
const relationOf = (limit: { direction: "max" | "min"; strict?: boolean }) =>
  limit.direction === "max" ? (limit.strict ? "below" : "atMost") : limit.strict ? "above" : "atLeast";
interface GateProposal {
  proposalId: string;
  feasibility: "qualified" | "needs_verification" | "fail" | "incomplete";
  requirements: GateRequirement[];
  causes: string[];
  /** #249: every check passed, but too few independent evaluators took part – a provisional favourite, not approvable. */
  limitedReview?: boolean;
  /** #249 part 2: every check passed, but a measurement check only has its plan confirmed – never approvable as finished. */
  architectureCandidate?: boolean;
}
export interface RequirementGateResult {
  proposals: GateProposal[];
  comparisonComplete: boolean;
  comparisonNote: string | null;
  summary: string | null;
}

/** Tone per feasibility; the words are `requirementGate.feasibility.<key>`. */
export const FEASIBILITY_TONE: Record<GateProposal["feasibility"], "success" | "warning" | "danger"> = {
  qualified: "success",
  needs_verification: "warning",
  fail: "danger",
  incomplete: "danger",
};

/**
 * The badge of one proposal: a provisional favourite (#249) or an architecture candidate (#249 part 2) is named as such
 * instead of "needs verification".
 */
export const feasibilityLabel = (p: Pick<GateProposal, "feasibility" | "limitedReview" | "architectureCandidate">) =>
  p.limitedReview
    ? { key: "provisional", tone: "warning" as const }
    : p.architectureCandidate
      ? { key: "architectureCandidate", tone: "warning" as const }
      : { key: p.feasibility, tone: FEASIBILITY_TONE[p.feasibility] };

/** Translated feasibility badge (text + tone) for one proposal. */
export function useFeasibilityLabel() {
  const t = useTranslations("requirementGate.feasibility");
  return (p: Pick<GateProposal, "feasibility" | "limitedReview" | "architectureCandidate">) => {
    const label = feasibilityLabel(p);
    return { text: t.has(label.key) ? t(label.key) : label.key.replaceAll("_", " "), tone: label.tone };
  };
}

/**
 * Per proposal and confirmed requirement: the status, who said what, and the evidence (#181, S1). Raw checks stay
 * visible, also duplicates, contradictions and checks that did not count.
 */
export function RequirementGateTable({ view, gate }: { view: View; gate: RequirementGateResult }) {
  const t = useTranslations("requirementGate");
  const tReq = useTranslations("verdict.dashboard.req");
  const gateText = useGateText();
  const feasibility = useFeasibilityLabel();
  const items = new Map((view.requirementList?.items ?? []).map((item) => [item.id, item.text]));
  const names = (ids: string[]) => ids.map((id) => modelName(view, id)).join(", ");
  const unitOf = (unit: string) => (unit === "%" ? " %" : unit === "EUR/month" ? ` ${t("eurPerMonth")}` : ` ${unit}`);
  return (
    <Card>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted">{t("intro")}</p>
      {gate.comparisonNote ? <p className="mt-2 text-sm text-warning">{gate.comparisonNote}</p> : null}
      <div className="mt-3 space-y-4">
        {gate.proposals.map((p) => {
          const label = feasibility(p);
          const raw = (view.requirementChecks ?? []).filter((c) => c.proposalId === p.proposalId);
          return (
            <section key={p.proposalId} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t("proposal", { label: proposalLabel(view, p.proposalId) })}</span>
                <Badge tone={label.tone}>{label.text}</Badge>
              </div>
              {p.causes.length ? (
                <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                  {p.causes.map((cause) => (
                    <li key={cause}>{gateText.cause(cause)}</li>
                  ))}
                </ul>
              ) : null}
              <ul className="mt-2 divide-y divide-line text-sm">
                {p.requirements.map((r) => {
                  const evidence = raw.filter((c) => c.requirementId === r.requirementId);
                  return (
                    <li key={r.requirementId} className="py-2">
                      <div className="flex flex-wrap items-start gap-2">
                        {r.buildVerification && r.status === "PASS" ? (
                          <span title={t("buildPendingHint")}>
                            <Badge tone="warning">{t("buildPending")}</Badge>
                          </span>
                        ) : r.measurementPending && r.status === "PASS" ? (
                          <span title={t("measurementPendingHint")} data-testid="measurement-pending">
                            <Badge tone="warning">{t("measurementPending")}</Badge>
                          </span>
                        ) : (
                          // #266: the word of the heatmap (with its symbol), never the raw code "PASS"/"FAIL".
                          <Badge tone={REQUIREMENT_CELL[requirementCellKey(r)].tone}>
                            {REQUIREMENT_CELL[requirementCellKey(r)].icon} {tReq(requirementCellKey(r))}
                          </Badge>
                        )}
                        <span>
                          <strong>{r.requirementId}</strong> {items.get(r.requirementId) ?? ""}
                        </span>
                      </div>
                      {r.estimate ? (
                        <p className="mt-1 text-xs">
                          {t("estimate.summary", {
                            n: r.estimate.evaluators,
                            low: fmt(r.estimate.low),
                            high: fmt(r.estimate.high),
                            unit: unitOf(r.estimate.limit.unit),
                            median: fmt(r.estimate.median),
                            relation: t(`relation.${relationOf(r.estimate.limit)}`),
                            limit: fmt(r.estimate.limit.value),
                          })}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted">
                        {[
                          r.pass.length ? t("pass", { names: names(r.pass) }) : "",
                          r.fail.length ? t("fail", { names: names(r.fail) }) : "",
                          r.unknown.length ? t("unknown", { names: names(r.unknown) }) : "",
                          r.open.length ? t("open", { names: names(r.open) }) : "",
                          r.conflicts.length ? t("conflicts", { names: names(r.conflicts) }) : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      </p>
                      {evidence.length ? (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-muted">{t("evidence", { n: evidence.length })}</summary>
                          <ul className="mt-1 space-y-1">
                            {evidence.map((c) => (
                              <li key={c.id}>
                                {modelName(view, c.evaluatorParticipantId)} – {tReq.has(c.status) ? tReq(c.status) : c.status}
                                {c.status === "PASS" && c.allPartsMet !== true ? ` ${t("notEveryPart")}` : ""}
                                {c.estimateLow != null && c.estimateHigh != null
                                  ? `, ${t("checkEstimate", { low: fmt(c.estimateLow), high: fmt(c.estimateHigh) })}`
                                  : ""}
                                : {c.evidence}
                                {c.valid ? "" : ` – ${t("didNotCount", { reason: c.invalidReason ?? "" })}`}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
