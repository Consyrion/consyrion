"use client";

import { Badge, Card } from "../ui/surface";
import { modelName, proposalLabel, type View } from "./helpers";

/** Shape of the engine's gate result stored in a version-2 matrix (#181, S1); the server computed it, this only shows it. */
interface GateRequirement {
  requirementId: string;
  status: "PASS" | "FAIL" | "DISPUTED" | "UNKNOWN";
  pass: string[];
  fail: string[];
  unknown: string[];
  open: string[];
  conflicts: string[];
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
  limit.direction === "max" ? (limit.strict ? "below" : "at most") : limit.strict ? "above" : "at least";
const unitOf = (unit: string) => (unit === "%" ? " %" : unit === "EUR/month" ? " EUR per month" : ` ${unit}`);
interface GateProposal {
  proposalId: string;
  feasibility: "qualified" | "needs_verification" | "fail" | "incomplete";
  requirements: GateRequirement[];
  causes: string[];
  /** #249: every check passed, but too few independent evaluators took part – a provisional favourite, not approvable. */
  limitedReview?: boolean;
}
export interface RequirementGateResult {
  proposals: GateProposal[];
  comparisonComplete: boolean;
  comparisonNote: string | null;
  summary: string | null;
}

export const FEASIBILITY_LABEL: Record<GateProposal["feasibility"], { text: string; tone: "success" | "warning" | "danger" }> = {
  qualified: { text: "meets all confirmed requirements", tone: "success" },
  needs_verification: { text: "needs verification", tone: "warning" },
  fail: { text: "requirement not met", tone: "danger" },
  incomplete: { text: "incomplete draft", tone: "danger" },
};

/** The badge of one proposal: a provisional favourite (#249) is named as such instead of "needs verification". */
export const feasibilityLabel = (p: Pick<GateProposal, "feasibility" | "limitedReview">) =>
  p.limitedReview ? { text: "provisional favourite – limited review", tone: "warning" as const } : FEASIBILITY_LABEL[p.feasibility];

const STATUS_TONE: Record<GateRequirement["status"], "success" | "warning" | "danger"> = {
  PASS: "success",
  UNKNOWN: "warning",
  DISPUTED: "warning",
  FAIL: "danger",
};

/**
 * Per proposal and confirmed requirement: the status, who said what, and the evidence (#181, S1). Raw checks stay
 * visible, also duplicates, contradictions and checks that did not count.
 */
export function RequirementGateTable({ view, gate }: { view: View; gate: RequirementGateResult }) {
  const items = new Map((view.requirementList?.items ?? []).map((item) => [item.id, item.text]));
  const names = (ids: string[]) => ids.map((id) => modelName(view, id)).join(", ");
  return (
    <Card>
      <h3 className="font-semibold">Confirmed requirements per proposal</h3>
      <p className="text-sm text-muted">
        A requirement counts as met only if every expected evaluator confirmed every part of it with a reason. PASS and FAIL are stored model judgements with
        reasons, not an independent fact check.
      </p>
      {gate.comparisonNote ? <p className="mt-2 text-sm text-warning">{gate.comparisonNote}</p> : null}
      <div className="mt-3 space-y-4">
        {gate.proposals.map((p) => {
          const label = feasibilityLabel(p);
          const raw = (view.requirementChecks ?? []).filter((c) => c.proposalId === p.proposalId);
          return (
            <section key={p.proposalId} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Proposal {proposalLabel(view, p.proposalId)}</span>
                <Badge tone={label.tone}>{label.text}</Badge>
              </div>
              {p.causes.length ? (
                <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                  {p.causes.map((cause) => (
                    <li key={cause}>{cause}</li>
                  ))}
                </ul>
              ) : null}
              <ul className="mt-2 divide-y divide-line text-sm">
                {p.requirements.map((r) => {
                  const evidence = raw.filter((c) => c.requirementId === r.requirementId);
                  return (
                    <li key={r.requirementId} className="py-2">
                      <div className="flex flex-wrap items-start gap-2">
                        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                        <span>
                          <strong>{r.requirementId}</strong> {items.get(r.requirementId) ?? ""}
                        </span>
                      </div>
                      {r.estimate ? (
                        <p className="mt-1 text-xs">
                          Estimated by {r.estimate.evaluators} model{r.estimate.evaluators === 1 ? "" : "s"}: {fmt(r.estimate.low)}–{fmt(r.estimate.high)}
                          {unitOf(r.estimate.limit.unit)} (median {fmt(r.estimate.median)}) · limit {relationOf(r.estimate.limit)} {fmt(r.estimate.limit.value)}
                          {unitOf(r.estimate.limit.unit)}. Met only if every range keeps the limit.
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted">
                        {r.pass.length ? `PASS: ${names(r.pass)}. ` : ""}
                        {r.fail.length ? `FAIL: ${names(r.fail)}. ` : ""}
                        {r.unknown.length ? `Not conclusive: ${names(r.unknown)}. ` : ""}
                        {r.open.length ? `No answer: ${names(r.open)}. ` : ""}
                        {r.conflicts.length ? `Contradictory (counted as FAIL): ${names(r.conflicts)}.` : ""}
                      </p>
                      {evidence.length ? (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-muted">Evidence ({evidence.length})</summary>
                          <ul className="mt-1 space-y-1">
                            {evidence.map((c) => (
                              <li key={c.id}>
                                {modelName(view, c.evaluatorParticipantId)} – {c.status}
                                {c.status === "PASS" && c.allPartsMet !== true ? " (not every part confirmed)" : ""}
                                {c.estimateLow != null && c.estimateHigh != null ? `, estimate ${fmt(c.estimateLow)}–${fmt(c.estimateHigh)}` : ""}: {c.evidence}
                                {c.valid ? "" : ` – did not count: ${c.invalidReason}`}
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
