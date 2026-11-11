import "server-only";
import { COUNCIL_PHASE_LABELS } from "@consyrium/core/browser";
import { reportTranslator, type ReportLocale } from "@consyrium/council";
import { createTranslator } from "next-intl";
import { messagesFor } from "@/i18n/all-messages";
import type { View } from "@/components/session/helpers";
import { deriveCruxes } from "@/components/session/cruxes";
import { deriveNextSteps } from "@/components/session/next-steps";
import type { RequirementGateResult } from "@/components/session/requirement-gate";
import { measurementRows } from "@/components/session/measurements";
import { PARTICIPATION_PHASES, participationMatrix, silentIn } from "@/components/session/participation";
import { processQualityLines } from "@/components/session/process-quality-lines";
import { buildReplayEvents } from "@/components/session/replay-events";
import { nextStepsTarget, verdictStatus } from "@/components/session/verdict-status";

/**
 * The status line of the PDF (#268), from the same derivation and the same words as the verdict screen and the
 * session header (`verdictStatus`, `verdict.dashboard.outcome.*`, `sessionWorkspace.status.*`) – the export has no
 * status logic of its own. Workflow and approval status stay apart (#477); the human decision is the workflow status.
 */
export interface ReportStatus {
  /** Verdict title, e.g. "Needs verification – not approvable"; null without a verdict. */
  title: string | null;
  /** True only when the server lets a human approve at least one proposal. */
  approvable: boolean;
  /** Workflow status and, when nothing can be approved, the approval status – as in the header. */
  line: string;
  /**
   * #268 part 2: the key disputes (#267, `deriveCruxes`, top 3) and the next steps (#273, `deriveNextSteps`) exactly as
   * the screen derives and words them – stored statements as written, fixed labels in the interface language.
   */
  cruxes?: { title: string; none: string; items: ReportBlock[] };
  /** #249 part 2: a favourite or prototype build, in the screen's words – a human action, never the verdict. */
  marks?: string[];
  /** #249 gate 2: acceptance by measurement as on the screen, every result named as a self-declaration with evidence. */
  measurements?: ReportBlock | null;
  nextSteps?: ReportBlock | null;
  /**
   * #268 part 4: the course of the council for the report pages – phase timeline (stored stage times, as in the
   * replay), participation and tokens per model (the participation matrix of the Council Room), follow-up check
   * rounds (#228/#229) and human decisions (the verdict screen's history), worded with the screen's messages.
   */
  process?: ReportBlock[];
}

/** A titled block of lines for the PDF: everything already worded, the PDF only lays it out. */
export interface ReportBlock {
  title: string;
  lines: string[];
  /** Shown in the warning ink (blocking, high/critical, not approvable). */
  warn?: boolean;
}

export function reportStatus(view: unknown, locale: ReportLocale): ReportStatus {
  // The session view as the browser receives it (dates as strings): the same input the screens derive from.
  // Lists a partial or older view may lack are empty, so a derivation never fails on a missing list.
  const json = { participants: [], proposals: [], messages: [], objections: [], approvals: [], ...JSON.parse(JSON.stringify(view)) } as View;
  const status = verdictStatus(json);
  const t = createTranslator({ locale, messages: messagesFor(locale) as never });
  // A missing key shows the stored value itself (as the screen does), never the message path.
  const tr = (key: string) =>
    (t as unknown as { has(k: string): boolean }).has(key) ? (t as unknown as (k: string) => string)(key) : (key.split(".").pop() ?? key);
  const workflow = status.nothingApprovable
    ? tr("sessionWorkspace.status.awaitingReview")
    : json.session?.status
      ? tr(`sessionWorkspace.status.${json.session.status}`)
      : "";
  const approvable = status.readable && !status.notApprovable && !status.conflict && status.approvableProposalIds.length > 0;
  const tv = (key: string, values?: Record<string, string | number>) =>
    (t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values);

  // Key disputes: the same call as the card on the Minority Review tab (recommendation as given by the verdict).
  const cruxItems: ReportBlock[] = json.decision
    ? deriveCruxes(json, json.decision.recommendedProposalId ?? null, 3).map((c, i) => ({
        title: [
          tv("verdict.cruxes.number", { n: i + 1 }),
          tv("verdict.cruxes.proposal", { label: c.proposal }),
          tr(`verdict.cruxes.severity.${c.severity}`),
          tr(`verdict.cruxes.status.${c.status}`),
          ...(c.blocking ? [tv("verdict.cruxes.blocking")] : []),
        ].join(" · "),
        lines: [
          `“${c.claim.text}”`,
          `${tv("verdict.cruxes.raisedBy")}: ${c.claim.by}`,
          `${tv("verdict.cruxes.authorAnswer", { model: c.author.by })}: ${
            c.author.unanswered
              ? tv("verdict.cruxes.unanswered", { reason: c.author.unanswered })
              : c.author.conceded
                ? tv("verdict.cruxes.conceded")
                : (c.author.response ?? tv("verdict.cruxes.noAnswer"))
          }`,
          `${tv("verdict.cruxes.changed")} ${
            c.revision
              ? tv(c.revision.moot ? "verdict.cruxes.revisedMoot" : "verdict.cruxes.revised", { version: c.revision.version })
              : tv("verdict.cruxes.notRevised")
          }`,
        ],
        warn: c.blocking || c.severity === "critical" || c.severity === "high",
      }))
    : [];

  // Next steps: the same proposal and mode as the verdict screen (nextStepsTarget), the same derivation.
  const target = nextStepsTarget(json, status);
  const gate = (json.decision?.matrix as { requirementGate?: RequirementGateResult } | undefined)?.requirementGate;
  const steps = target ? deriveNextSteps(json, target.proposalId, gate) : null;
  const label = steps ? (json.proposals.find((p) => p.id === steps.proposalId)?.label ?? "?") : "?";
  const intro = { chosen: "introChosen", recommended: "introRecommended", tie: "introTie", favorite: "introFavorite", blocked: "introLeading" } as const;
  const nextSteps: ReportBlock | null =
    steps && target
      ? {
          title: tv("verdict.nextSteps.title"),
          lines: [
            tv(`verdict.nextSteps.${intro[target.mode]}`, { label }),
            `${tv("verdict.nextSteps.verify.title")}:`,
            ...(steps.verify.length || steps.objections.length
              ? [
                  ...steps.verify.map((r) => `• ${r.id} ${r.text} (${tr(`verdict.dashboard.req.${r.status}`)})`),
                  ...steps.objections.map(
                    (o) => `• ${o.claim} (${tr(`verdict.cruxes.severity.${o.severity}`)}; ${tv("verdict.nextSteps.verify.raisedBy", { model: o.by })})`,
                  ),
                ]
              : [`• ${tv("verdict.nextSteps.verify.empty")}`]),
            `${tv("verdict.nextSteps.counter.title")}:`,
            steps.counter
              ? `• ${steps.counter.claim} (${tv("verdict.nextSteps.verify.raisedBy", { model: steps.counter.by })}) – ${
                  steps.counter.evidence ? tv("verdict.nextSteps.counter.rightIf", { text: steps.counter.evidence }) : tv("verdict.nextSteps.counter.noReason")
                }`
              : `• ${tv("verdict.nextSteps.counter.empty")}`,
            `${tv("verdict.nextSteps.assumptions.title")}:`,
            ...(steps.assumptions.length ? steps.assumptions.map((a) => `• ${a}`) : [`• ${tv("verdict.nextSteps.assumptions.empty")}`]),
            `${tv("verdict.nextSteps.test.title")}:`,
            steps.cheapestTest
              ? `• ${[
                  steps.cheapestTest.method ? tv("verdict.nextSteps.test.method", { text: steps.cheapestTest.method }) : null,
                  steps.cheapestTest.successCriterion
                    ? tv("verdict.nextSteps.test.success", { text: steps.cheapestTest.successCriterion })
                    : tv("verdict.nextSteps.test.noSuccess"),
                ]
                  .filter(Boolean)
                  .join(" · ")} (${tv("verdict.nextSteps.aiSuggestion")})`
              : `• ${tv("verdict.nextSteps.test.empty")}`,
            `${tv("verdict.nextSteps.stopIf.title")}`,
            ...(steps.stopCriteria.length || steps.stopIf.length
              ? [
                  ...steps.stopCriteria.map((c) => `• ${c} (${tv("verdict.nextSteps.aiSuggestion")})`),
                  ...steps.stopIf.map((r) => `• ${r.risk}${r.mitigation ? ` – ${tv("verdict.nextSteps.stopIf.mitigation", { text: r.mitigation })}` : ""}`),
                ]
              : [`• ${tv("verdict.nextSteps.stopIf.empty")}`]),
            ...(target.mode === "blocked" || target.mode === "favorite" ? [tv("verdict.nextSteps.notYet")] : []),
          ],
          warn: target.mode === "blocked" || target.mode === "favorite",
        }
      : null;

  const cruxes = { title: tv("verdict.cruxes.title"), none: tv("verdict.cruxes.none"), items: cruxItems };
  const labelOf = (id: string) => json.proposals.find((p) => p.id === id)?.label ?? "?";
  const marks = status.humanMark
    ? [
        tv(status.humanMark.kind === "prototype_build" ? "verdictScreen.mark.prototype" : "verdictScreen.mark.favorite", {
          label: labelOf(status.humanMark.proposalId),
        }),
      ]
    : [];
  const rows = measurementRows(json, gate);
  const measurements: ReportBlock | null = rows.length
    ? {
        title: tv("measurement.title"),
        lines: rows.flatMap((p) => [
          tv("measurement.proposal", { label: labelOf(p.proposalId) }),
          ...p.requirements.flatMap((r) => [
            `• ${tr(`measurement.${r.state}`)}: ${r.requirementId} ${r.text}`,
            ...r.own.map(
              (m) =>
                `   ${tv("measurement.selfDeclared", { person: m.recordedBy, evidence: m.evidence })} · ${tv("measurement.values", { method: m.method, target: m.target, measured: m.measured })}`,
            ),
          ]),
        ]),
        warn: rows.some((p) => p.requirements.some((r) => r.state === "notMet")),
      }
    : null;
  const process = processBlocks(json, tv, tr, locale);
  return {
    cruxes,
    nextSteps,
    marks,
    measurements,
    process,
    title: status.outcomeKey ? tr(`verdict.dashboard.outcome.${status.outcomeKey}`) : null,
    approvable,
    line: status.nothingApprovable ? `${workflow} · ${tr("sessionWorkspace.status.noApprovableProposal")}` : workflow,
  };
}

type Tv = (key: string, values?: Record<string, string | number>) => string;
const stamp = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const minutes = (from: string, to: string) => {
  const m = Math.round((Date.parse(to) - Date.parse(from)) / 60000);
  // Under a minute is not "0 min" (live check 08.11.26).
  return m < 1 ? "< 1" : String(m);
};

/** The course of the council (#268 part 4) – only stored rows, through the screen's own derivations. */
function processBlocks(view: View, tv: Tv, tr: (key: string) => string, locale: ReportLocale): ReportBlock[] {
  const t = reportTranslator(locale);
  const blocks: ReportBlock[] = [];
  // 1. Phase timeline: the stage events of the replay (stored start and end times, nothing estimated).
  const { events } = buildReplayEvents(view);
  const starts = new Map(events.filter((e) => e.kind === "stage_started").map((e) => [e.phase, e.at]));
  const ends = events.filter((e) => e.kind === "stage_completed");
  const timeline = [...starts.entries()].map(([phase, start]) => {
    const end = ends.find((e) => e.phase === phase);
    const name = phase ? tr(`councilRoom.participation.phase.${phase}`) : "?";
    return end
      ? t("{phase}: {start} – {end} ({minutes} min)", {
          phase: phase === "execution_council" ? "Execution Council" : name,
          start: stamp(start),
          end: stamp(end.at),
          minutes: minutes(start, end.at),
        })
      : t("{phase}: from {start}, not finished", { phase: name, start: stamp(start) });
  });
  if (timeline.length) blocks.push({ title: t("Phase timeline"), lines: timeline });

  // 2. Participation and tokens per model: the participation matrix of the Council Room plus the stored usage.
  const rows = participationMatrix(view);
  const ran = new Set(events.filter((e) => e.kind === "stage_started").map((e) => e.phase));
  const usage = (view.usage ?? []) as Array<{ participantId: string | null; inputTokens: number | string; outputTokens: number | string }>;
  // #561: phases a model was never asked in because the budget shortened them (participation.shortfalls[].notCalled,
  // phase labels) – "not called", not "no contribution".
  const shortfalls = ((view as { participation?: { shortfalls?: Array<{ participantId: string; notCalled?: string[] }> } }).participation?.shortfalls ??
    []) as Array<{
    participantId: string;
    notCalled?: string[];
  }>;
  const notCalled = (participantId: string, phase: string) =>
    shortfalls.some(
      (sf) => sf.participantId === participantId && (sf.notCalled ?? []).includes(COUNCIL_PHASE_LABELS[phase as keyof typeof COUNCIL_PHASE_LABELS]),
    );
  const lines = rows.flatMap((row) => {
    const p = view.participants.find((x) => x.id === row.participantId);
    const name = `${p?.provider ?? "?"} · ${p?.modelId ?? "?"}${row.instance ? ` (${tv("councilRoom.participation.instance", { index: row.instance.index, total: row.instance.total })})` : ""}`;
    const tokens = usage
      .filter((u) => u.participantId === row.participantId)
      .reduce((a, u) => ({ input: a.input + Number(u.inputTokens), output: a.output + Number(u.outputTokens) }), { input: 0, output: 0 });
    const phases = PARTICIPATION_PHASES.map((phase) => {
      const c = row.cells[phase];
      const parts = [
        notCalled(row.participantId, phase)
          ? t("not called (phase shortened by the budget)")
          : silentIn(row, phase, ran.has(phase))
            ? tv("councilRoom.participation.silent")
            : null,
        c.ok ? tv("councilRoom.participation.calls", { n: c.ok }) : null,
        c.contributions ? tv("councilRoom.participation.contributions", { n: c.contributions }) : null,
        c.failed ? tv("councilRoom.participation.failed", { n: c.failed }) : null,
      ].filter(Boolean);
      return parts.length ? `${tr(`councilRoom.participation.phase.${phase}`)}: ${parts.join(", ")}` : null;
    }).filter(Boolean);
    return [
      `${name}${p?.status === "failed" ? t(" (failed)") : ""} – ${t("Total: {input} input + {output} output tokens", { input: tokens.input, output: tokens.output })}`,
      ...phases.map((x) => `   ${x}`),
    ];
  });
  if (lines.length) blocks.push({ title: tv("councilRoom.participation.title"), lines });

  // 2b. Process quality (#182): the same wording as the card in the Evaluation tab, with its limits.
  const quality = processQualityLines(view, (key, values) => tv(`processQuality.${key}`, values));
  if (quality)
    blocks.push({
      title: tv("processQuality.title"),
      lines: [
        tv("processQuality.intro"),
        ...quality.flatMap((q) => [`${q.title}: ${q.text}`, ...(q.limit ? [`   ${q.limit}`] : [])]),
        tv("processQuality.footer"),
      ],
    });

  // 3. Follow-up check rounds (#228/#229), as stored with the verdict.
  const followUps = ((view.decision?.matrix as { followUpRounds?: Array<{ round: number; kind: string; items: number; applied: boolean }> } | undefined)
    ?.followUpRounds ?? []) as Array<{ round: number; kind: string; items: number; applied: boolean }>;
  if (followUps.length)
    blocks.push({
      title: t("Follow-up check rounds"),
      lines: followUps.map((f) =>
        t(
          f.applied
            ? "Round {round} ({kind}): {items} checks requested – done, results taken over"
            : "Round {round} ({kind}): {items} checks requested – not finished, nothing taken over",
          {
            round: f.round,
            kind: t(f.kind === "targeted_review" ? "targeted review" : "completion"),
            items: f.items,
          },
        ),
      ),
    });

  // 4. Human decisions: the verdict screen's history, in its words.
  const approvals = (view.approvals ?? []) as Array<{ action: string; comment: string | null; createdAt: string }>;
  if (approvals.length)
    blocks.push({
      title: tv("verdictScreen.history.title"),
      lines: approvals.map(
        (a) => `${a.createdAt ? `${stamp(a.createdAt)} · ` : ""}${tr(`verdictScreen.history.action.${a.action}`)}${a.comment ? ` – ${a.comment}` : ""}`,
      ),
    });
  return blocks;
}
