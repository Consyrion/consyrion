"use client";

import { AskAssistantButton } from "../assistant-open";
import { CRITERIA, dedupeSamePoint, dedupeStatements, verdictCaution, type ConfidenceIssue, type Confidence, type Criterion } from "@consyrium/core/browser";
import { EngineText, useConfidenceIssueText, useUndefendedReasonText } from "./engine-text";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { SendDecision } from "../delivery";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { buttonClasses, Button } from "../ui/button";
import { SelectField, TextAreaField } from "../ui/field";
import { CouncilNetwork } from "../dashboard/council-network";
import { Alert, Badge, Card, EmptyState } from "../ui/surface";
import { RequirementGateTable, useFeasibilityLabel, type RequirementGateResult } from "./requirement-gate";
import { FollowUpCard } from "./follow-up-card";
import { explainNoRecommendation, type WhyProposal } from "./why-no-recommendation";
import { MeasurementPanel } from "./measurement-panel";
import { ProcessQualityCard } from "./process-quality-card";
import {
  contentOf,
  latestRevision,
  modelName,
  proposalLabel,
  SEVERITY_TONE,
  STATUS_TONE,
  useEnumText,
  useResponseText,
  useRoleLabel,
  useGateText,
  useIneligibleReason,
  useReadableFormula,
  useVerdictReason,
  type ProposalContent,
  type ProposalJson,
  type View,
} from "./helpers";
import { WhyPerspectives } from "./why-perspectives";
import { CruxesCard } from "./cruxes-card";
import { CouncilQuestions, ObjectionInterventions } from "./human-questions";
import { NextStepsCard } from "./next-steps-card";
import { deriveNextSteps } from "./next-steps";
import { ProcessCharts } from "./process-charts";
import { score1 } from "./verdict-dashboard";
import { nextStepsTarget, verdictStatus } from "./verdict-status";
import { councilPurpose, ideaCheck, type IdeaCheckMatrix } from "./idea-check";
import { VerdictDashboard, type DashboardMatrix, type NextAction, type OutcomeKey } from "./verdict-dashboard";

/** Criterion names, shared with the verdict dashboard (`verdict.dashboard.criteria`). */
function useCriterionLabel() {
  const t = useTranslations("verdict.dashboard.criteria");
  return (criterion: string) => (t.has(criterion) ? t(criterion) : criterion);
}

function List({ items, empty }: { items: string[]; empty?: string }) {
  const t = useTranslations("phaseScreens");
  if (!items.length) return <p className="text-sm text-muted">{empty ?? t("none")}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function stageStatus(view: View, phase: string) {
  return view.stages.find((s) => s.phase === phase)?.status ?? "pending";
}

function Waiting({ view, phase, text }: { view: View; phase: string; text: string }) {
  const t = useTranslations("phaseScreens.waiting");
  const status = stageStatus(view, phase);
  if (status === "running") return <EmptyState title={t("inProgress")} description={text} />;
  if (status === "failed") return <EmptyState title={t("failed")} description={view.stages.find((s) => s.phase === phase)?.error ?? t("failedDefault")} />;
  if (status === "cancelled") return <EmptyState title={t("stopped")} description={t("stoppedText")} />;
  return <EmptyState title={t("notStarted")} description={text} />;
}

/* ---------- #39 Independent Thinking ---------- */

export function IndependentThinkingScreen({ view }: { view: View }) {
  const stage = stageStatus(view, "independent_thinking");
  const usage = view.usage.filter((u) => u.phase === "independent_thinking");
  const revealed = view.proposals.length > 0;
  const t = useTranslations("phaseScreens.independent");
  const format = useFormatter();
  return (
    <div className="space-y-4">
      <Alert tone="warning">{t("blind")}</Alert>
      <Card>
        <CouncilNetwork
          centerLabel={revealed ? t("centerReveal") : t("centerBlind")}
          nodes={view.participants.map((p) => {
            const rows = usage.filter((u) => u.participantId === p.id);
            const ok = rows.some((r) => r.outcome === "ok");
            const state = p.status === "failed" ? "failed" : ok ? "done" : stage === "running" ? "working" : "idle";
            return { id: p.id, label: p.provider, sublabel: p.modelId, state };
          })}
          caption={t("networkCaption")}
        />
      </Card>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {view.participants.map((p) => {
          const rows = usage.filter((u) => u.participantId === p.id);
          const ok = rows.some((r) => r.outcome === "ok");
          const state =
            p.status === "failed"
              ? "failed"
              : ok
                ? "submitted"
                : stage === "running"
                  ? "working"
                  : stage === "pending"
                    ? "waiting"
                    : rows.length
                      ? "failed"
                      : "waiting";
          const tokens = rows.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0);
          return (
            <Card key={p.id}>
              <p className="font-medium">{modelName(view, p.id)}</p>
              <div className="mt-2 flex items-center gap-2">
                <Badge tone={state === "submitted" ? "success" : state === "failed" ? "danger" : state === "working" ? "primary" : "neutral"}>
                  {t(`state.${state}`)}
                </Badge>
                {tokens ? <span className="text-xs text-muted">{t("tokens", { n: format.number(tokens) })}</span> : null}
              </div>
              {p.failureReason ? <p className="mt-2 text-sm text-danger">{p.failureReason}</p> : null}
            </Card>
          );
        })}
      </div>
      <p className="text-sm text-muted">
        {revealed && stage === "failed"
          ? t("tooFew", { arrived: view.proposals.length, total: view.participants.length })
          : revealed
            ? t("revealed", { n: view.proposals.length })
            : t("submitted", { submitted: view.submittedCount, total: view.participants.length })}
      </p>
    </div>
  );
}

/* ---------- #40 Open Council ---------- */

function ProposalCard({ view, proposal, onOpen }: { view: View; proposal: ProposalJson; onOpen: () => void }) {
  const c = contentOf(proposal, 1);
  const t = useTranslations("phaseScreens");
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="primary">{t("proposal", { label: proposal.label ?? "" })}</Badge>
        {proposal.kind === "hybrid" ? <Badge tone="accent">{t("hybrid")}</Badge> : null}
      </div>
      <h3 className="mt-3 font-semibold">{c.title}</h3>
      <p className="mt-1 text-sm text-muted">{c.summary}</p>
      {c.components.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {c.components.slice(0, 8).map((x) => (
            <Badge key={x}>{x}</Badge>
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-sm font-medium">{t("strengths")}</p>
      <List items={c.advantages.slice(0, 4)} />
      <p className="mt-3 text-sm">
        <span className="text-muted">{t("costLabel")}</span> {c.costEstimate || t("notProvided")} · <span className="text-muted">{t("confidenceLabel")}</span>{" "}
        {c.confidence} %
      </p>
      <p className="mt-1 text-xs text-muted">
        {proposal.authorParticipantId ? t("author", { model: modelName(view, proposal.authorParticipantId) }) : t("authorHidden")}
      </p>
      <Button variant="secondary" className="mt-4" onClick={onOpen}>
        {t("viewFull")}
      </Button>
    </Card>
  );
}

function ProposalDetail({ view, proposal, version, onClose }: { view: View; proposal: ProposalJson; version?: number; onClose: () => void }) {
  const c = contentOf(proposal, version);
  const t = useTranslations("phaseScreens");
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{t("proposalTitle", { label: proposal.label ?? "", title: c.title })}</h3>
        <Button variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <p className="text-sm font-medium">{t("fields.summary")}</p>
          <p className="text-sm">{c.summary}</p>
          <p className="mt-3 text-sm font-medium">{t("fields.architecture")}</p>
          <p className="whitespace-pre-wrap text-sm">{c.architecture}</p>
          <p className="mt-3 text-sm font-medium">{t("fields.components")}</p>
          <List items={c.components} />
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">{t("fields.advantages")}</p>
            <List items={c.advantages} />
          </div>
          <div>
            <p className="text-sm font-medium">{t("fields.disadvantages")}</p>
            <List items={c.disadvantages} />
          </div>
          <div>
            <p className="text-sm font-medium">{t("fields.risks")}</p>
            <List items={c.risks.map((r) => t("riskItem", { risk: r.risk, severity: r.severity, mitigation: r.mitigation }))} />
          </div>
          <div>
            <p className="text-sm font-medium">{t("fields.assumptions")}</p>
            <List items={c.assumptions} />
          </div>
          <div>
            <p className="text-sm font-medium">{t("fields.recommendations")}</p>
            <List items={c.recommendations} />
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">
        {t("ownClaims")} {proposal.authorParticipantId ? t("authorSentence", { model: modelName(view, proposal.authorParticipantId) }) : ""}
      </p>
    </Card>
  );
}

export function OpenCouncilScreen({ view }: { view: View }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<"cards" | "compare">("cards");
  const t = useTranslations("phaseScreens");
  const originals = view.proposals.filter((p) => p.kind === "original");
  if (!originals.length) return <Waiting view={view} phase="independent_thinking" text={t("open.waiting")} />;
  const selected = originals.find((p) => p.id === open);
  const comparisons = view.messages.filter((m) => m.phase === "open_council" && m.kind === "comparison");
  const questions = view.messages.filter((m) => m.phase === "open_council" && m.kind === "question");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t("open.neutral")}</p>
        <div className="flex gap-2">
          <Button variant={mode === "cards" ? "primary" : "secondary"} onClick={() => setMode("cards")}>
            {t("open.cards")}
          </Button>
          <Button variant={mode === "compare" ? "primary" : "secondary"} onClick={() => setMode("compare")}>
            {t("open.compare")}
          </Button>
        </div>
      </div>
      {selected ? <ProposalDetail view={view} proposal={selected} version={1} onClose={() => setOpen(null)} /> : null}
      {mode === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {originals.map((p) => (
            <ProposalCard key={p.id} view={view} proposal={p} onOpen={() => setOpen(p.id)} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="p-3">{t("open.aspect")}</th>
                {originals.map((p) => (
                  <th key={p.id} className="p-3">
                    {t("proposal", { label: p.label ?? "" })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(
                [
                  [t("fields.title"), (c: ProposalContent) => c.title],
                  [t("fields.architecture"), (c: ProposalContent) => c.architecture],
                  [t("fields.cost"), (c: ProposalContent) => c.costEstimate || t("notProvided")],
                  [t("fields.risks"), (c: ProposalContent) => c.risks.map((r) => `${r.risk} (${r.severity})`).join("; ") || t("noneStated")],
                  [t("fields.disadvantages"), (c: ProposalContent) => c.disadvantages.join("; ") || t("noneStated")],
                  [t("fields.confidence"), (c: ProposalContent) => `${c.confidence} %`],
                ] as const
              ).map(([label, get]) => (
                <tr key={label}>
                  <th className="p-3 align-top font-medium">{label}</th>
                  {originals.map((p) => (
                    <td key={p.id} className="p-3 align-top">
                      {get(contentOf(p, 1))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Card>
        <h3 className="font-semibold">{t("open.commonTitle")}</h3>
        {comparisons.length === 0 ? <Waiting view={view} phase="open_council" text={t("open.compareWaiting")} /> : null}
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {comparisons.map((m) => {
            const body = JSON.parse(m.body) as { commonGround: string[]; keyDifferences: string[] };
            return (
              <div key={m.id} className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{modelName(view, m.participantId)}</p>
                <p className="mt-2 text-sm font-medium">{t("open.commonGround")}</p>
                <List items={body.commonGround} />
                <p className="mt-2 text-sm font-medium">{t("open.keyDifferences")}</p>
                <List items={body.keyDifferences} />
              </div>
            );
          })}
        </div>
      </Card>
      {questions.length ? (
        <Card>
          <h3 className="font-semibold">{t("open.qa")}</h3>
          <ul className="mt-3 space-y-3">
            {questions.map((q) => {
              const answer = view.messages.find((m) => m.kind === "answer" && m.parentId === q.id);
              return (
                <li key={q.id} className="rounded-lg border border-line p-3 text-sm">
                  <p>
                    <Badge>{t("proposal", { label: proposalLabel(view, q.targetProposalId) })}</Badge>{" "}
                    <span className="text-muted">{t("open.asks", { model: modelName(view, q.participantId) })}</span> {q.body}
                  </p>
                  <p className="mt-2 border-l-2 border-primary/50 pl-3">{answer ? answer.body : <span className="text-muted">{t("open.noAnswer")}</span>}</p>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/* ---------- #41 12 Minds Council ---------- */

export function TwelveMindsScreen({ view }: { view: View }) {
  const messages = view.messages.filter((m) => m.phase === "twelve_minds_council");
  const rounds = [...new Set(messages.map((m) => m.round))].sort();
  const [round, setRound] = useState<number | "all">("all");
  const [proposalFilter, setProposalFilter] = useState<string>("all");
  const critiques = messages.filter(
    (m) => m.kind === "critique" && (round === "all" || m.round === round) && (proposalFilter === "all" || m.targetProposalId === proposalFilter),
  );
  const preferences = messages.filter((m) => m.kind === "preference" && (round === "all" || m.round === round));
  const open = critiques.filter((c) => !messages.some((r) => r.kind === "rebuttal" && r.parentId === c.id && r.evidence === "concedes"));
  const t = useTranslations("phaseScreens");
  const roleLabel = useRoleLabel();
  const severityText = useEnumText("verdict.cruxes.severity");
  const categoryText = useEnumText("verdict.cruxes.category");

  return (
    <div className="space-y-5">
      <Card>
        <h3 className="font-semibold">{t("minds.perspectives")}</h3>
        <p className="text-sm text-muted">{t("minds.perspectivesNote")}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {view.roles.map((r) => {
            const done = preferences.some((p) => p.role === r.role);
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span>
                  {roleLabel(r.role)}
                  <span className="block text-xs text-muted">{modelName(view, r.participantId)}</span>
                </span>
                <Badge tone={done ? "success" : "neutral"}>{done ? t("minds.reviewed") : t("minds.pending")}</Badge>
              </li>
            );
          })}
        </ul>
        <WhyPerspectives view={view} />
      </Card>
      {messages.length === 0 ? (
        <Waiting view={view} phase="twelve_minds_council" text={t("minds.waiting")} />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <SelectField label={t("minds.round")} value={String(round)} onChange={(e) => setRound(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">{t("minds.allRounds")}</option>
              {rounds.map((r) => (
                <option key={r} value={r}>
                  {t("minds.roundN", { n: r })}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("proposalField")} value={proposalFilter} onChange={(e) => setProposalFilter(e.target.value)}>
              <option value="all">{t("minds.allProposals")}</option>
              {view.proposals.map((p) => (
                <option key={p.id} value={p.id}>
                  {t("proposal", { label: p.label ?? "" })}
                </option>
              ))}
            </SelectField>
            <p className="self-end pb-2 text-sm text-muted">{t("minds.counts", { critiques: critiques.length, open: open.length })}</p>
          </div>
          <ul className="space-y-3">
            {critiques.map((c) => {
              const replies = messages.filter((m) => m.kind === "rebuttal" && m.parentId === c.id);
              return (
                <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="primary">{t("proposal", { label: proposalLabel(view, c.targetProposalId) })}</Badge>
                    <Badge tone={SEVERITY_TONE[(c.severity ?? "low") as keyof typeof SEVERITY_TONE]}>{severityText(c.severity)}</Badge>
                    <Badge>{categoryText(c.category)}</Badge>
                    <span className="text-muted">{t("minds.meta", { role: roleLabel(c.role), model: modelName(view, c.participantId), round: c.round })}</span>
                  </div>
                  <p className="mt-2 text-sm">{c.body}</p>
                  {c.evidence ? (
                    <p className="mt-1 text-sm text-muted">
                      {t("evidenceLabel")} {c.evidence}
                    </p>
                  ) : null}
                  {replies.map((r) => (
                    <div key={r.id} className="mt-3 border-l-2 border-accent/60 pl-3 text-sm">
                      <p className="text-xs text-muted">
                        {t("minds.response")} {r.evidence === "concedes" ? `· ${t("minds.concedes")}` : ""}
                      </p>
                      <p>{r.body}</p>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
          <Card>
            <h3 className="font-semibold">{t("minds.preferences")}</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {preferences.map((p) => (
                <li key={p.id}>
                  <span className="text-muted">{roleLabel(p.role)}:</span> {t("proposal", { label: proposalLabel(view, p.targetProposalId) })} – {p.body}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

/* ---------- #42 Minority Review & Consensus Round ---------- */

function DiffRows({ before, after }: { before: ProposalContent; after: ProposalContent }) {
  const keys = Object.keys(after) as Array<keyof ProposalContent>;
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const t = useTranslations("phaseScreens.diff");
  if (!changed.length) return <p className="text-sm text-muted">{t("none")}</p>;
  const show = (value: unknown) => (Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("\n") : String(value));
  return (
    <div className="space-y-3">
      {changed.map((k) => (
        <div key={k} className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-danger/30 bg-danger/5 p-2 text-sm">
            <p className="text-xs text-muted">{t("before", { field: k })}</p>
            <p className="whitespace-pre-wrap">{show(before[k])}</p>
          </div>
          <div className="rounded-lg border border-success/30 bg-success/5 p-2 text-sm">
            <p className="text-xs text-muted">{t("after", { field: k })}</p>
            <p className="whitespace-pre-wrap">{show(after[k])}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MinorityConsensusScreen({ view, canApprove = false }: { view: View; canApprove?: boolean }) {
  const [section, setSection] = useState<"minority" | "consensus">("minority");
  const [proposalId, setProposalId] = useState<string | null>(view.proposals[0]?.id ?? null);
  const review = view.minorityReview;
  const proposal = view.proposals.find((p) => p.id === proposalId);
  const t = useTranslations("phaseScreens");
  const reasonText = useUndefendedReasonText();
  const responseText = useResponseText();
  const severityText = useEnumText("verdict.cruxes.severity");
  const categoryText = useEnumText("verdict.cruxes.category");
  const statusText = useEnumText("phaseScreens.objectionStatus");
  const consensusText = useEnumText("phaseScreens.consensus.status");
  return (
    <div className="space-y-5">
      {/* #267: the decisive disputes above the long objection list, from the same stored rows. */}
      <CruxesCard view={view} recommendedId={view.decision?.recommendedProposalId ?? null} />
      <div className="flex gap-2" role="tablist">
        <Button
          role="tab"
          aria-selected={section === "minority"}
          variant={section === "minority" ? "primary" : "secondary"}
          onClick={() => setSection("minority")}
        >
          Minority Review
        </Button>
        <Button
          role="tab"
          aria-selected={section === "consensus"}
          variant={section === "consensus" ? "primary" : "secondary"}
          onClick={() => setSection("consensus")}
        >
          Consensus Round
        </Button>
      </div>

      {section === "minority" ? (
        !review && view.objections.length === 0 ? (
          <Waiting view={view} phase="minority_review" text={t("minority.waiting")} />
        ) : (
          <>
            {review ? (
              <Card>
                <p className="text-sm">
                  {t("minority.favoured")}{" "}
                  <strong>
                    {review.favoredProposalId ? t("proposal", { label: proposalLabel(view, review.favoredProposalId) }) : t("minority.noFavourite")}
                  </strong>
                  {review.favoredProposalId
                    ? ` ${t("minority.majority", { majority: review.majorityModelCount, independent: review.independentModelCount })}`
                    : ""}
                  . {review.reevaluationTriggered ? <Badge tone="warning">{t("minority.reevaluation")}</Badge> : null}
                </p>
              </Card>
            ) : null}
            {view.objections.length === 0 ? <p className="text-sm text-muted">{t("minority.none")}</p> : null}
            <ul className="space-y-3">
              {view.objections.map((o) => (
                <li key={o.id} className="rounded-xl border border-line bg-surface p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="primary">{t("proposal", { label: proposalLabel(view, o.proposalId) })}</Badge>
                    <Badge tone={SEVERITY_TONE[o.severity]}>{severityText(o.severity)}</Badge>
                    <Badge>{categoryText(o.category)}</Badge>
                    <Badge tone={STATUS_TONE[o.status]}>{statusText(o.status)}</Badge>
                    {o.blocking ? <Badge tone="danger">{t("minority.blocks")}</Badge> : null}
                    <span className="text-muted">{t("minority.raisedBy", { model: modelName(view, o.raisedByParticipantId) })}</span>
                  </div>
                  <p className="mt-2">
                    {t("minority.objection")} {o.claim}
                  </p>
                  {o.evidence ? (
                    <p className="mt-1 text-muted">
                      {t("evidenceLabel")} {o.evidence}
                    </p>
                  ) : null}
                  <p className="mt-2 border-l-2 border-accent/60 pl-3">
                    <span className="text-xs text-muted">{t("minority.response")}</span>
                    <br />
                    {o.response
                      ? responseText(o.response)
                      : o.undefendedReason
                        ? t("notDefended", { reason: reasonText(o.undefendedReason) })
                        : t("minority.noResponse")}
                  </p>
                  {o.resolutionReason ? (
                    <p className="mt-2 text-muted">
                      {o.reviewedByParticipantId ? t("minority.reviewBy", { model: modelName(view, o.reviewedByParticipantId) }) : t("minority.review")}{" "}
                      <EngineText text={o.resolutionReason} />
                    </p>
                  ) : null}
                  {/* #15/#41: a human's statement request and mark – appendix only, no effect on the verdict. */}
                  <ObjectionInterventions view={view} objectionId={o.id} canApprove={canApprove} />
                </li>
              ))}
            </ul>
          </>
        )
      ) : !view.consensus ? (
        <Waiting view={view} phase="consensus_round" text={t("consensus.waiting")} />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{t("consensus.result")}</span>
              <Badge tone={view.consensus.status === "consensus" ? "success" : view.consensus.status === "partial" ? "warning" : "neutral"}>
                {consensusText(view.consensus.status)}
              </Badge>
              {view.consensus.basedOn?.length ? (
                <span className="text-sm text-muted">
                  {t("consensus.basedOn", { list: view.consensus.basedOn.map((r) => `${r.label} v${r.version}`).join(" · ") })}
                </span>
              ) : null}
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-sm font-medium">{t("consensus.agreements")}</p>
                <List items={view.consensus.agreements} />
              </div>
              <div>
                <p className="text-sm font-medium">{t("consensus.disagreements")}</p>
                <List items={view.consensus.disagreements} />
              </div>
              <div>
                <p className="text-sm font-medium">{t("consensus.risks")}</p>
                <List items={view.consensus.outstandingRisks} />
              </div>
            </div>
          </Card>
          <div className="flex flex-wrap gap-2">
            {view.proposals.map((p) => (
              <Button key={p.id} variant={p.id === proposalId ? "primary" : "secondary"} onClick={() => setProposalId(p.id)}>
                {t("consensus.proposalVersion", { label: p.label ?? "", hybrid: p.kind === "hybrid" ? "yes" : "no", version: latestRevision(p).version })}
              </Button>
            ))}
          </div>
          {proposal ? (
            <Card>
              <h3 className="font-semibold">{t("consensus.versions", { label: proposal.label ?? "", version: latestRevision(proposal).version })}</h3>
              <div className="mt-3 space-y-3">
                {proposal.revisions.slice(1).map((r) => (
                  <div key={r.id} className="text-sm">
                    <p className="font-medium">
                      {t("consensus.version", { version: r.version })} {r.keptPosition ? <Badge>{t("consensus.kept")}</Badge> : null}
                    </p>
                    <List
                      items={(r.changes as Array<{ change?: string; reason?: string; motivatedBy?: string[] }>).map(
                        (c) =>
                          `${c.change ?? ""}${c.reason ? ` – ${c.reason}` : ""}${c.motivatedBy?.length ? ` (${t("consensus.refs", { n: c.motivatedBy.length })})` : ""}`,
                      )}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <DiffRows before={contentOf(proposal, 1)} after={contentOf(proposal)} />
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ---------- #43 Evaluation ---------- */

interface MatrixProposal {
  proposalId: string;
  criterionMeans: Partial<Record<Criterion, number>>;
  criterionSpread: Partial<Record<Criterion, number>>;
  total: number | null;
  independentEvaluators: number;
  expectedEvaluators?: number | null;
  /** Absent in matrices from before the feasibility check (#121): treated as implementable. */
  implementable?: boolean;
  requirementChecks?: { failed: number; total: number };
  eligible: boolean;
  ineligibleReasons: string[];
  bordaPoints: number;
}

interface DecisionMatrix {
  proposals: MatrixProposal[];
  /** Gate version 2 (#181, S1): the engine's result per proposal and requirement. */
  requirementGate?: RequirementGateResult;
  requirementsConflict?: boolean;
  majorityVoteWinnerId: string | null;
  confidence?: Confidence;
  confidenceIssues?: ConfidenceIssue[];
  failedEvaluators?: { participantId: string; modelId: string; outcome: string }[];
}

/** Why an evaluator has no usable scores (`evaluationScreen.failure.<outcome>`); unknown outcomes show the raw value. */
function useFailureText() {
  const t = useTranslations("evaluationScreen.failure");
  return (outcome: string) => (t.has(outcome) ? t(outcome) : outcome);
}

/** Warns when the verdict rests on incomplete evaluations or the majority vote disagrees with the score. */
function ConfidenceNotice({ view, matrix, recommendedProposalId }: { view: View; matrix: DecisionMatrix; recommendedProposalId: string | null }) {
  // Decisions computed before confidence tracking existed: derive coverage from the participant count.
  const issues: ConfidenceIssue[] = matrix.confidenceIssues ?? [
    ...matrix.proposals
      .filter((p) => p.independentEvaluators < view.participants.length - 1)
      .map((p) => ({
        kind: "missing_evaluators" as const,
        proposalId: p.proposalId,
        evaluators: p.independentEvaluators,
        expected: view.participants.length - 1,
      })),
    ...(recommendedProposalId && matrix.majorityVoteWinnerId && matrix.majorityVoteWinnerId !== recommendedProposalId
      ? [{ kind: "vote_disagrees" as const, majorityVoteWinnerId: matrix.majorityVoteWinnerId }]
      : []),
  ];
  const failed = matrix.failedEvaluators ?? [];
  const t = useTranslations("evaluationScreen");
  const failureText = useFailureText();
  const issueText = useConfidenceIssueText();
  if (issues.length === 0 && failed.length === 0) return null;
  const level = matrix.confidence ?? "low";
  const label = (id: string) => proposalLabel(view, id);
  return (
    <Alert tone="warning">
      <p className="font-medium">{level === "reduced" ? t("confidenceReduced") : t("confidenceLow")}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {failed.map((f) => (
          <li key={f.participantId}>{t("couldNotEvaluate", { model: f.modelId, reason: failureText(f.outcome) })}</li>
        ))}
        {issues.map((issue, index) => (
          <li key={`${issue.kind}-${index}`}>{issueText(issue, label)}.</li>
        ))}
      </ul>
      {/* QA 12.11.26: the hint named «Bewertung wiederholen» although no evaluation was missing and the option was disabled. */}
      {level === "low" ? <p className="mt-1">{failed.length ? (matrix.requirementGate ? t("hintRepeat") : t("hintDebate")) : t("hintReview")}</p> : null}
    </Alert>
  );
}

/**
 * #230: the first thing to read when a council ends without a recommendation because an evaluation is missing – a
 * technical gap, not a finding about the proposals – and the next step that is actually available.
 */
function MainReason({ view, matrix, canRepeat }: { view: View; matrix: DecisionMatrix; canRepeat: boolean }) {
  const failed = matrix.failedEvaluators ?? [];
  const t = useTranslations("evaluationScreen.mainReason");
  const failureText = useFailureText();
  if (failed.length === 0 || view.decision?.outcome === "recommended") return null;
  const names = failed.map((f) => `${f.modelId} (${failureText(f.outcome)})`).join(", ");
  const open = (matrix.requirementGate?.proposals ?? []).filter((g) => g.feasibility === "needs_verification").length;
  return (
    <div className="mt-3 rounded-lg border border-warning/50 p-3 text-sm" data-testid="main-reason">
      <p>
        <span className="font-medium">{t("title")}</span> {open ? t("bodyOpen", { names, open }) : t("body", { names })}
      </p>
      <p className="mt-1 text-muted">{canRepeat ? t("nextRepeat") : t("next")}</p>
    </div>
  );
}

/**
 * #230: why there is no approvable recommendation – one plain sentence per proposal (violated, disputed, not fully
 * evaluated, not proven) and only the next steps that exist today. Explains the stored gate result, never re-decides.
 */
function WhyNoRecommendationCard({
  view,
  matrix,
  outcome,
  approvableProposals,
  canFollowUp = false,
  onChange,
}: {
  view: View;
  matrix: DecisionMatrix;
  outcome: string;
  approvableProposals: number;
  /** #228/#229: the owner may start a follow-up round (awaiting approval, decision:approve). */
  canFollowUp?: boolean;
  onChange?: () => Promise<void>;
}) {
  const t = useTranslations("verdictScreen.why");
  const tp = useTranslations("phaseScreens");
  const why = explainNoRecommendation(view, matrix.requirementGate, {
    requirementsConflict: matrix.requirementsConflict,
    failedEvaluators: (matrix.failedEvaluators ?? []).length,
    approvableProposals,
  });
  if (!why || why.proposals.length === 0) return null;
  const line = (p: WhyProposal) => {
    const list = p.requirements.join(", ");
    if (p.kind === "violated") return p.counts ? t("violatedCount", { list, fail: p.counts.fail, total: p.counts.total }) : t("violated", { list });
    if (p.kind === "disputed") return p.counts ? t("disputedCount", { list, pass: p.counts.pass, fail: p.counts.fail }) : t("disputed", { list });
    return t(p.kind, { list });
  };
  return (
    <div className="mt-3 rounded-lg border border-line p-3 text-sm" data-testid="why-no-recommendation">
      <p className="font-medium">{t("title")}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {why.requirementsConflict ? <li>{t("conflict")}</li> : null}
        {why.proposals.map((p) => (
          <li key={p.proposalId}>
            {tp("proposal", { label: proposalLabel(view, p.proposalId) })}: {line(p)}
          </li>
        ))}
      </ul>
      {outcome === "no_qualifying_solution" ? <p className="mt-1 text-muted">{t("onlyThese")}</p> : null}
      <p className="mt-1 text-xs text-muted">{t("modelJudgement")}</p>
      {why.steps.length ? (
        <>
          <p className="mt-2 font-medium">{t("nextTitle")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {why.steps.map((step) => (
              <li key={step}>{t(`next.${step}`)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {canFollowUp && onChange ? <FollowUpCard sessionId={view.session.id} onStarted={onChange} /> : null}
    </div>
  );
}

export function EvaluationScreen({ view }: { view: View }) {
  const matrix = view.decision?.matrix as
    | {
        proposals: MatrixProposal[];
        weights: Record<Criterion, number>;
        formula: string;
        majorityVoteWinnerId: string | null;
        requirementGate?: RequirementGateResult;
      }
    | undefined;
  const [drill, setDrill] = useState<string | null>(null);
  const t = useTranslations("evaluationScreen");
  const tp = useTranslations("phaseScreens");
  const criterionLabel = useCriterionLabel();
  const ineligibleReason = useIneligibleReason();
  const formulaText = useReadableFormula();
  const feasibility = useFeasibilityLabel();
  if (!matrix) return <Waiting view={view} phase="final_verdict" text={t("waiting")} />;
  // A matrix of a format this version does not know (#181): the server says so; nothing is guessed from it.
  if (view.decisionStatus && !view.decisionStatus.readable) return <EmptyState title={t("notShown")} description={view.decisionStatus.reason ?? ""} />;
  const ordered = [...matrix.proposals].sort((a, b) => proposalLabel(view, a.proposalId).localeCompare(proposalLabel(view, b.proposalId)));
  const drillProposal = view.proposals.find((p) => p.id === drill);
  const drillScores = drillProposal ? view.scores.filter((s) => s.revisionId === latestRevision(drillProposal).id) : [];
  return (
    <div className="space-y-5">
      <ConfidenceNotice view={view} matrix={matrix as DecisionMatrix} recommendedProposalId={view.decision?.recommendedProposalId ?? null} />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="p-3 text-left text-muted">{t("caption")}</caption>
          <thead className="bg-surface-2">
            <tr>
              <th className="p-3">{t("criterionWeight")}</th>
              {ordered.map((p) => (
                <th key={p.proposalId} className="p-3">
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => setDrill(p.proposalId)}>
                    {tp("proposal", { label: proposalLabel(view, p.proposalId) })}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {CRITERIA.map((criterion) => (
              <tr key={criterion}>
                <th className="p-3 font-medium">
                  {criterionLabel(criterion)} ({matrix.weights[criterion]} %)
                </th>
                {ordered.map((p) => (
                  <td key={p.proposalId} className="p-3">
                    {p.criterionMeans[criterion] ?? "–"}
                    {p.criterionSpread[criterion] ? <span className="text-xs text-muted"> ±{p.criterionSpread[criterion]}</span> : null}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-surface-2 font-semibold">
              <th className="p-3">{t("weightedTotal")}</th>
              {ordered.map((p) => (
                <td key={p.proposalId} className="p-3">
                  <span title={p.total != null ? String(p.total) : undefined}>{score1(p.total)}</span>
                </td>
              ))}
            </tr>
            <tr>
              <th className="p-3 font-medium">{t("meetsHard")}</th>
              {ordered.map((p) => (
                <td key={p.proposalId} className="p-3">
                  {matrix.requirementGate ? (
                    (() => {
                      const entry = matrix.requirementGate.proposals.find((g) => g.proposalId === p.proposalId);
                      const label = entry ? feasibility(entry) : { text: t("notEvaluated"), tone: "danger" as const };
                      return <Badge tone={label.tone}>{label.text}</Badge>;
                    })()
                  ) : p.implementable === false ? (
                    <Badge tone="danger">{t("finding")}</Badge>
                  ) : (
                    <Badge tone="success">{t("yes")}</Badge>
                  )}
                  {!matrix.requirementGate && p.requirementChecks?.total ? (
                    <span className="mt-1 block text-xs text-muted">
                      {t("evaluatorsMet", { met: p.requirementChecks.total - p.requirementChecks.failed, total: p.requirementChecks.total })}
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
            <tr>
              <th className="p-3 font-medium">{t("gates")}</th>
              {ordered.map((p) => (
                <td key={p.proposalId} className="p-3">
                  {p.eligible ? <Badge tone="success">{t("eligible")}</Badge> : <Badge tone="danger">{t("notEligible")}</Badge>}
                  {/* The server's approvability is the final word (ChatGPT test 06.11.26): passing the gates is not enough when the
                      council as a whole cannot recommend (e.g. conflict of interest, incomplete comparison). */}
                  {p.eligible && view.decisionStatus && !(view.decisionStatus.approvableProposalIds ?? []).includes(p.proposalId) ? (
                    <span className="mt-1 block text-xs text-warning">! {t("eligibleButBlocked")}</span>
                  ) : null}
                  {p.ineligibleReasons.map((r) => (
                    <span key={r} className="mt-1 block text-xs text-danger">
                      {ineligibleReason(r)}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
            <tr>
              <th className="p-3 font-medium">{t("evaluatorsPoints")}</th>
              {ordered.map((p) => (
                <td key={p.proposalId} className="p-3">
                  {p.independentEvaluators} / {p.bordaPoints}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">
        {t("formula", {
          formula: formulaText(view, matrix.formula, matrix.weights, (c) => criterionLabel(c as Criterion)),
          winner: matrix.majorityVoteWinnerId ? tp("proposal", { label: proposalLabel(view, matrix.majorityVoteWinnerId) }) : t("noMajority"),
        })}
      </p>
      {matrix.requirementGate ? <RequirementGateTable view={view} gate={matrix.requirementGate} /> : null}
      {/* #182: how the council worked, from stored data – no proof of a right verdict. */}
      <ProcessQualityCard view={view} />
      {drillProposal ? (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t("scoresFor", { label: drillProposal.label ?? "" })}</h3>
            <Button variant="ghost" onClick={() => setDrill(null)}>
              {tp("close")}
            </Button>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {drillScores.map((s) => (
              <li key={s.id}>
                <Badge>{criterionLabel(s.criterion)}</Badge> <strong>{s.score}/10</strong>{" "}
                <span className="text-muted">
                  {t("scoreBy", { model: modelName(view, s.evaluatorParticipantId) })}
                  {weightsDiffer(view)
                    ? ` ${t("voteWeight", { weight: view.participants.find((p) => p.id === s.evaluatorParticipantId)?.voteWeight ?? 1 })}`
                    : ""}
                </span>{" "}
                – {s.rationale}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/** True when the models of this run vote with different weights (#140); equal weights need no explanation. */
function weightsDiffer(view: View) {
  return new Set(view.participants.map((p) => p.voteWeight ?? 1)).size > 1;
}

/* ---------- #44 Final Verdict ---------- */

/** Valid participation rate (#182): models with a valid contribution in every phase they were called in. */
function ValidParticipation({ view }: { view: View }) {
  const p = view.participation;
  const t = useTranslations("verdictScreen.participation");
  if (!p || p.percent === null) return null;
  // QA 12.11.26: a model counts as taking part once one call per phase succeeded – the failed ones are named beside it.
  const failedCalls = (p as { failedCalls?: { participantId: string; phase: string; calls: number }[] }).failedCalls ?? [];
  return (
    <p className="text-sm text-muted" data-testid="valid-participation">
      {t("label")}{" "}
      <strong className={p.valid === p.total ? "text-text" : "text-warning"}>
        {p.valid}/{p.total}
      </strong>{" "}
      ({p.percent} %)
      {p.shortfalls.length
        ? ` – ${t("short", { list: p.shortfalls.map((s) => `${modelName(view, s.participantId)} (${s.phases.length ? s.phases.join(", ") : t("noValid")})`).join(", ") })}`
        : ` – ${t("all")}`}
      {failedCalls.length ? (
        <span className="text-warning">
          {" "}
          {t("failedCalls", {
            n: failedCalls.reduce((sum, f) => sum + f.calls, 0),
            list: failedCalls.map((f) => `${modelName(view, f.participantId)} – ${f.phase}${f.calls > 1 ? ` ×${f.calls}` : ""}`).join(", "),
          })}
        </span>
      ) : null}
    </p>
  );
}

// Titles: `verdict.dashboard.outcome.<key>` (shared with the dashboard); derived in verdict-status.ts.
export function VerdictScreen({ view, canApprove, onChange }: { view: View; canApprove: boolean; onChange: () => Promise<void> }) {
  const decision = view.decision;
  // Approvability comes from the server (#181, stage 1); this screen only displays it and never re-checks the format.
  // One derivation for this screen, the header and the PDF (#268): verdictStatus.
  const status = view.decisionStatus;
  const verdict = verdictStatus(view);
  const { readable, notApprovable, conflict, s1, initialAction } = verdict;
  const matrix = readable ? (decision?.matrix as unknown as DecisionMatrix | undefined) : undefined;
  const missingEvaluators = (matrix?.failedEvaluators ?? []).length;
  // The form offers decisions only; "record_measurement" points to the measurement panel instead.
  const [action, setAction] = useState<string>(initialAction === "record_measurement" ? "request_changes" : initialAction);
  const [comment, setComment] = useState("");
  const [alternative, setAlternative] = useState("");
  // Owner decision 13.11.26: approving against open critical/high objections needs an explicit risk acceptance.
  const [acceptRisk, setAcceptRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("verdictScreen");
  const reasonText = useUndefendedReasonText();
  const tp = useTranslations("phaseScreens");
  const tOutcome = useTranslations("verdict.dashboard.outcome");
  const format = useFormatter();
  const feasibility = useFeasibilityLabel();
  const statusText = useEnumText("phaseScreens.objectionStatus");
  const severityText = useEnumText("verdict.cruxes.severity");
  const categoryText = useEnumText("verdict.cruxes.category");
  const verdictReason = useVerdictReason();
  const gateText = useGateText();
  // Night test 07.11.26: "could not confirm that a proposal meets every requirement" was wrong when one did – the
  // verdict only withheld the recommendation because the author of the qualified proposal alone blocked a better one.
  const conflictIssue = (
    (decision?.matrix as { confidenceIssues?: Array<{ kind: string; proposalId?: string; blockedProposalId?: string }> } | undefined)?.confidenceIssues ?? []
  ).find((issue) => issue.kind === "conflict_of_interest");
  const conflictReason = conflictIssue
    ? t("reasons.conflictOfInterest", {
        qualified: proposalLabel(view, conflictIssue.proposalId),
        blocked: proposalLabel(view, conflictIssue.blockedProposalId),
      })
    : null;
  if (!decision) return <Waiting view={view} phase="final_verdict" text={t("waiting")} />;
  const recommended = view.proposals.find((p) => p.id === decision.recommendedProposalId);
  const content = recommended ? contentOf(recommended) : null;
  // Objections against an earlier revision whose subject is gone are not risks of the recommendation (#150).
  const open = recommended ? view.objections.filter((o) => o.proposalId === recommended.id && (o.status === "accepted" || o.status === "unresolved")) : [];
  const openObjections = {
    current: open.filter((o) => !o.moot),
    moot: open.flatMap((o) => (o.moot ? [{ ...o, ...o.moot }] : [])),
  };
  const change = recommended?.architectureChange ?? null;
  const blocked = new Set(view.objections.filter((o) => o.blocking && ["open", "accepted", "unresolved"].includes(o.status)).map((o) => o.proposalId));
  const outcomeKey: OutcomeKey = verdict.outcomeKey ?? "not_approvable";
  const outcome = { title: tOutcome(outcomeKey), tone: verdict.tone };
  const findings = new Set((matrix?.proposals ?? []).filter((p) => p.implementable === false).map((p) => p.proposalId));
  // #548: the project is archived – read-only, decisions are refused by the server.
  const archivedProject = (view.project as { status?: string }).status === "archived";
  // #249 part 2 / #478: computed on the server, only displayed here.
  const prototypeIds = new Set(status?.prototypeProposalIds ?? []);
  const measuredIds = new Set(status?.measurementApprovableProposalIds ?? []);
  const approvableIds = new Set(status?.approvableProposalIds ?? []);
  const notImplementable = new Set(view.proposals.filter((p) => !approvableIds.has(p.id)).map((p) => p.id));
  // A proposal whose requirements are all confirmed but which another rule blocks must not read "requirements not met"
  // (ChatGPT test 06.11.26, Tags session): say what is true.
  const qualified = new Set((matrix?.requirementGate?.proposals ?? []).filter((g) => g.feasibility === "qualified").map((g) => g.proposalId));
  // #511: an architecture candidate passed every check; only its measurement is open.
  const candidates = new Map(
    (matrix?.requirementGate?.proposals ?? [])
      .filter((g) => g.architectureCandidate)
      .map((g) => [
        g.proposalId,
        g.requirements
          .filter((r) => r.measurementPending)
          .map((r) => r.requirementId)
          .join(", "),
      ]),
  );
  const notApprovableText = (id: string) =>
    s1 && candidates.has(id)
      ? t("notApprovable.architectureCandidate", { ids: candidates.get(id)! })
      : s1
        ? qualified.has(id)
          ? t("notApprovable.qualifiedBlocked")
          : t("notApprovable.s1")
        : findings.has(id)
          ? t("notApprovable.finding")
          : t("notApprovable.other");
  // The same conflict named by several proposals is listed once (#173).
  const conflicts = dedupeStatements(view.proposals.flatMap((p) => contentOf(p).requirementConflicts ?? []));
  const total = (proposalId: string) => (matrix as { proposals?: MatrixProposal[] } | undefined)?.proposals?.find((p) => p.proposalId === proposalId)?.total;
  // The proposal this action would build and the open critical/high objections against it – same rule as the server
  // (openRiskObjections in the council service), which refuses the approval without the acceptance.
  const riskTarget = action === "approve" ? (decision?.recommendedProposalId ?? null) : BUILD_FORM_ACTIONS.has(action) ? alternative || null : null;
  const riskObjections = riskTarget
    ? view.objections.filter(
        (o) =>
          o.proposalId === riskTarget &&
          ["open", "accepted", "unresolved"].includes(o.status) &&
          !o.moot &&
          (o.severity === "critical" || o.severity === "high"),
      )
    : [];
  const riskCritical = riskObjections.filter((o) => o.severity === "critical").length;
  const riskMissing = riskObjections.length > 0 && (!acceptRisk || (riskCritical > 0 && !comment.trim()));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/sessions/${view.session.id}/approval`, {
        method: "POST",
        body: JSON.stringify({ action, comment, selectedProposalId: PROPOSAL_ACTIONS.has(action) ? alternative : undefined, acceptRisk }),
      });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("recordError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* #279: ask the assistant about this decision – opens the panel with a question, nothing is sent yet. */}
      <div className="flex justify-end">
        <AskAssistantButton variant="ghost" />
      </div>
      {matrix ? (
        <VerdictDashboard
          view={view}
          matrix={matrix as unknown as DashboardMatrix}
          outcome={outcome}
          outcomeKey={outcomeKey}
          // No next step in an archived project – nothing can be decided there (#548, verdictStatus.archived).
          nextAction={view.session.status === "awaiting_approval" && canApprove && !verdict.archived ? (initialAction as NextAction) : null}
          reason={notApprovable ? (conflictReason ?? verdictReason(status?.reason)) : gateText.summary(matrix.requirementGate?.summary)}
          approvableIds={approvableIds}
          recommendedId={notApprovable ? null : (decision.recommendedProposalId ?? null)}
          // #597: an idea-check council reads a verdict without anything approvable as a favourite with open points.
          idea={notApprovable && councilPurpose(view.session.policy) === "idea_check" ? ideaCheck(matrix as unknown as IdeaCheckMatrix) : null}
          answer={(() => {
            // ChatGPT review of #631: after the decision the hero keeps showing the answer – of the proposal the human chose.
            const last = view.approvals.at(-1);
            const chosenId =
              last?.action === "select_alternative"
                ? (last.selectedProposalId ?? null)
                : last?.action === "reject"
                  ? null
                  : notApprovable
                    ? null
                    : (decision.recommendedProposalId ?? null);
            const chosen = chosenId ? view.proposals.find((p) => p.id === chosenId) : null;
            if (!chosen) return null;
            const c = contentOf(chosen);
            return { title: c.title, summary: c.summary, recommendations: c.recommendations ?? [] };
          })()}
          // One rule for this hero and the report (core verdictCaution): critical and high counted apart.
          caution={verdictCaution({
            recommendedProposalId: notApprovable ? null : decision.recommendedProposalId,
            objections: view.objections,
            confidence: matrix.confidence ?? null,
            legacyIssueCount: (matrix.confidenceIssues?.length ?? 0) + missingEvaluators,
          })}
        />
      ) : null}
      {(() => {
        // #273: for the recommendation, or – when nothing can be approved – for the best-scored proposal (#268: shared).
        const target = matrix ? nextStepsTarget(view, verdict) : null;
        if (!matrix || !target) return null;
        const mode = target.mode;
        const steps = deriveNextSteps(view, target.proposalId, matrix.requirementGate);
        return steps ? <NextStepsCard view={view} steps={steps} mode={mode} /> : null;
      })()}
      {matrix ? (
        <ProcessCharts
          view={view}
          criterionMeans={Object.fromEntries(
            (matrix.proposals as Array<{ proposalId: string; criterionMeans?: Partial<Record<Criterion, number>> }>).map((p) => [
              p.proposalId,
              p.criterionMeans ?? {},
            ]),
          )}
        />
      ) : null}
      {matrix ? <ConfidenceNotice view={view} matrix={matrix} recommendedProposalId={decision.recommendedProposalId} /> : null}
      <ValidParticipation view={view} />
      {weightsDiffer(view) ? (
        <p className="text-sm text-muted">
          {t("voteWeights", { list: view.participants.map((p) => `${modelName(view, p.id)} ${p.voteWeight}/10`).join(" · ") })}
        </p>
      ) : null}
      <Card className={outcome.tone === "success" ? "border-success/50" : outcome.tone === "danger" ? "border-danger/50" : ""}>
        <Badge tone={outcome.tone}>{outcome.title}</Badge>
        {matrix ? <MainReason view={view} matrix={matrix} canRepeat={canApprove} /> : null}
        {matrix && s1 && (notApprovable || decision.outcome !== "recommended") ? (
          <WhyNoRecommendationCard
            view={view}
            matrix={matrix}
            outcome={decision.outcome}
            approvableProposals={approvableIds.size}
            canFollowUp={canApprove && view.session.status === "awaiting_approval"}
            onChange={onChange}
          />
        ) : null}
        {/* #15/#41: questions to the council after the verdict – appendix only. */}
        <CouncilQuestions view={view} canApprove={canApprove} />
        {notApprovable && status?.reason ? (
          <p className="mt-3 text-sm" data-testid="not-approvable-reason">
            {conflictReason ?? verdictReason(status.reason)} {t("notApprovableHint")}
          </p>
        ) : null}
        {s1 && matrix?.requirementGate ? (
          <div className="mt-3 text-sm">
            {matrix.requirementGate.summary ? <p>{gateText.summary(matrix.requirementGate.summary)}</p> : null}
            {(() => {
              // Requirements confirmed, but another gate (security minimum, minimum score, blocking objection) failed –
              // not the same as unmet requirements (#181 review).
              const otherGate = matrix.requirementGate.proposals.filter(
                (g) => g.feasibility === "qualified" && matrix.proposals.find((p) => p.proposalId === g.proposalId)?.eligible === false,
              );
              return otherGate.length ? (
                <p className="mt-1">
                  {t(otherGate.length === 1 ? "otherGateOne" : "otherGateMany", {
                    proposals: otherGate.map((g) => tp("proposal", { label: proposalLabel(view, g.proposalId) })).join(", "),
                  })}
                </p>
              ) : null;
            })()}
            {matrix.requirementGate.comparisonNote ? <p className="mt-1">{matrix.requirementGate.comparisonNote}</p> : null}
            <ul className="mt-1 list-disc pl-5 text-muted">
              {matrix.requirementGate.proposals.map((g) => (
                <li key={g.proposalId}>
                  {tp("proposal", { label: proposalLabel(view, g.proposalId) })}: {feasibility(g).text}
                  {g.causes.length ? ` – ${gateText.cause(g.causes[0]!)}${g.causes.length > 1 ? ` ${t("moreCauses", { n: g.causes.length - 1 })}` : ""}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted">{t("gateNote")}</p>
          </div>
        ) : null}
        {recommended && content ? (
          <>
            <h2 className="mt-3 text-xl font-semibold">{tp("proposalTitle", { label: recommended.label ?? "", title: content.title })}</h2>
            <p className="text-sm text-muted">
              {t("byTotal", { model: modelName(view, recommended.authorParticipantId), total: score1(total(recommended.id)) })}
            </p>
            {change?.changed ? (
              <p className="mt-2 text-sm text-warning">
                {change.adoptedFrom.length
                  ? t("archChangeAdopted", { version: recommended.revisions.at(-1)?.version ?? "", from: change.adoptedFrom.join(", ") })
                  : t("archChange", { version: recommended.revisions.at(-1)?.version ?? "" })}
              </p>
            ) : null}
            <p className="mt-3 text-sm">{content.summary}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-sm font-medium">{t("mainStrengths")}</p>
                <List items={content.advantages} />
              </div>
              <div>
                <p className="text-sm font-medium">{t("mainWeaknesses")}</p>
                <List items={content.disadvantages} />
              </div>
              <div>
                <p className="text-sm font-medium">{t("remainingRisks")}</p>
                <List
                  items={dedupeSamePoint(
                    [
                      ...content.risks.map((r) => ({
                        statement: r.risk,
                        line: t("riskMitigation", { risk: r.risk, severity: severityText(r.severity), mitigation: r.mitigation }),
                        rank: 0,
                      })),
                      ...openObjections.current.map((o) => ({
                        statement: o.claim,
                        line: t(o.status === "accepted" ? "openObjectionAccepted" : "openObjectionUnresolved", { claim: o.claim }),
                        rank: o.status === "accepted" ? 1 : 2,
                      })),
                    ],
                    (entry) => entry.statement,
                    (entry) => entry.rank,
                  ).map((entry) => entry.line)}
                />
              </div>
            </div>
            {openObjections.moot.length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">{t("mootSummary", { n: openObjections.moot.length })}</summary>
                <List items={openObjections.moot.map((o) => t("mootItem", { claim: o.claim, against: o.againstVersion, current: o.currentVersion }))} />
              </details>
            ) : null}
          </>
        ) : conflict ? (
          <>
            <p className="mt-3 text-sm">{t("conflictText")}</p>
            {conflicts.length ? (
              <div className="mt-3">
                <p className="text-sm font-medium">{t("conflicting")}</p>
                <List items={conflicts} />
              </div>
            ) : null}
          </>
        ) : notApprovable ? null : (
          <p className="mt-3 text-sm">{decision.outcome === "tie" ? t("tieText") : t("noRecommendation")}</p>
        )}
      </Card>

      <Card>
        {/* Objections, not minority opinions (#169): the badge says how the objection was decided, not the proposal. */}
        <h3 className="font-semibold">{t("objections.title")}</h3>
        {view.objections.length === 0 ? (
          <p className="text-sm text-muted">{t("objections.none")}</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {view.objections.map((o) => (
              <li key={o.id}>
                <Badge tone={STATUS_TONE[o.status]}>{statusText(o.status)}</Badge>{" "}
                {t("objections.line", {
                  model: modelName(view, o.raisedByParticipantId),
                  label: proposalLabel(view, o.proposalId),
                  category: categoryText(o.category),
                  severity: severityText(o.severity),
                  claim: o.claim,
                })}
                {o.blocking ? <span className="text-danger"> – {t("objections.blocks")}</span> : null}
                {o.evidence ? (
                  <span className="block text-muted">
                    {t("objections.reasoning")} {o.evidence}
                  </span>
                ) : null}
                {o.resolutionReason ? (
                  <span className="block text-muted">
                    {t("objections.decision")} <EngineText text={o.resolutionReason} />
                  </span>
                ) : null}
                {o.undefendedReason && !o.response ? (
                  <span className="text-warning"> – {t("objections.notDefended", { reason: reasonText(o.undefendedReason) })}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {view.consensus?.disagreements.length ? <p className="mt-2 text-xs text-muted">{t("objections.disagreements")}</p> : null}
      </Card>

      <Card>
        <h3 className="font-semibold">{t("alternatives")}</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {view.proposals
            .filter((p) => p.id !== decision.recommendedProposalId)
            .map((p) => (
              <li key={p.id}>
                <strong>{tp("proposal", { label: p.label ?? "" })}</strong> – {t("alternativeScore", { title: contentOf(p).title, total: score1(total(p.id)) })}
                {blocked.has(p.id) ? <span className="text-danger"> – {t("blocked")}</span> : null}
                {notImplementable.has(p.id) ? <span className="text-danger"> – {notApprovableText(p.id)}</span> : null}
                <span className="block text-muted">{contentOf(p).summary}</span>
              </li>
            ))}
        </ul>
      </Card>

      <div className="flex flex-wrap gap-2">
        {/* PDF in three levels (#268): one page for decision makers, the full report, or everything for an audit. */}
        <a className={buttonClasses("primary")} href={`/api/sessions/${view.session.id}/report?format=pdf&level=brief`} title={t("export.briefTitle")}>
          {t("export.brief")}
        </a>
        <a className={buttonClasses("secondary")} href={`/api/sessions/${view.session.id}/report?format=pdf`} title={t("export.reportTitle")}>
          {t("export.report")}
        </a>
        <a className={buttonClasses("secondary")} href={`/api/sessions/${view.session.id}/report?format=pdf&level=full`} title={t("export.fullTitle")}>
          {t("export.full")}
        </a>
        <a className={buttonClasses("secondary")} href={`/api/sessions/${view.session.id}/report?format=docx`}>
          {t("export.word")}
        </a>
        <a className={buttonClasses("secondary")} href={`/api/sessions/${view.session.id}/report`}>
          {t("export.markdown")}
        </a>
        <a className={buttonClasses("secondary")} href={`/api/sessions/${view.session.id}/report?format=json`}>
          {t("export.json")}
        </a>
      </div>

      {view.humanMark ? (
        <Alert tone="warning">
          <span data-testid="human-mark">
            {t(view.humanMark.kind === "prototype_build" ? "mark.prototype" : "mark.favorite", { label: proposalLabel(view, view.humanMark.proposalId) })}
          </span>
        </Alert>
      ) : null}
      {readable && matrix?.requirementGate ? (
        <MeasurementPanel
          view={view}
          gate={matrix.requirementGate}
          canRecord={canApprove && view.session.status === "awaiting_approval" && !archivedProject}
          onChange={onChange}
        />
      ) : null}

      <SendDecision sessionId={view.session.id} projectDefault={view.project.deliveryDefault ?? null} />

      {view.approvals.length ? (
        <Card>
          <h3 className="font-semibold">{t("history.title")}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {view.approvals.map((a) => (
              <li key={a.id}>
                {format.dateTime(new Date(a.createdAt), { dateStyle: "short", timeStyle: "medium" })} –{" "}
                {t.has(`history.action.${a.action}`) ? t(`history.action.${a.action}`) : a.action.replaceAll("_", " ")}
                {a.comment ? `: ${a.comment}` : ""}
              </li>
            ))}
          </ul>
          {view.previousDecisions.length ? <p className="mt-2 text-xs text-muted">{t("history.superseded", { n: view.previousDecisions.length })}</p> : null}
        </Card>
      ) : null}

      {view.session.status === "awaiting_approval" && archivedProject ? (
        // #548: an archived project is read-only – the server refuses every decision, so none is offered.
        <Alert tone="warning">
          <span data-testid="archived-decision">{t("form.archived")}</span>
        </Alert>
      ) : view.session.status === "awaiting_approval" ? (
        canApprove ? (
          <Card id="your-decision" className="scroll-mt-20">
            <h3 className="font-semibold">{t("form.title")}</h3>
            <p className="text-sm text-muted">{t("form.intro")}</p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <SelectField label={t("form.action")} value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="approve" disabled={!status?.canApproveRecommendation}>
                  {t("form.approve")}
                </option>
                <option value="select_alternative" disabled={conflict || notApprovable || (readable && (status?.approvableProposalIds ?? []).length === 0)}>
                  {t("form.selectAlternative")}
                </option>
                {/* #249 part 2 / #478: a favourite or a marked prototype build – never a regular approval. */}
                {prototypeIds.size ? (
                  <>
                    <option value="mark_favorite">{t("form.markFavorite")}</option>
                    <option value="approve_prototype">{t("form.approvePrototype")}</option>
                  </>
                ) : null}
                {measuredIds.size ? <option value="approve_after_measurement">{t("form.approveAfterMeasurement")}</option> : null}
                <option value="repeat_evaluation" disabled={missingEvaluators === 0}>
                  {t("form.repeat", { n: missingEvaluators })}
                </option>
                {s1 ? null : <option value="request_more_debate">{t("form.moreDebate")}</option>}
                <option value="request_changes">{s1 ? t("form.requestChangesS1") : t("form.requestChanges")}</option>
                <option value="reject">{conflict ? t("form.rejectConflict") : t("form.reject")}</option>
              </SelectField>
              {action === "select_alternative" ? (
                <SelectField label={tp("proposalField")} value={alternative} onChange={(e) => setAlternative(e.target.value)}>
                  <option value="">{t("form.choose")}</option>
                  {view.proposals.map((p) => (
                    <option key={p.id} value={p.id} disabled={blocked.has(p.id) || notImplementable.has(p.id)}>
                      {tp("proposal", { label: p.label ?? "" })}
                      {blocked.has(p.id) ? ` (${t("blocked")})` : notImplementable.has(p.id) ? ` (${notApprovableText(p.id)})` : ""}
                    </option>
                  ))}
                </SelectField>
              ) : PROPOSAL_ACTIONS.has(action) ? (
                <SelectField label={tp("proposalField")} value={alternative} onChange={(e) => setAlternative(e.target.value)}>
                  <option value="">{t("form.choose")}</option>
                  {view.proposals.map((p) => {
                    const allowed = (action === "approve_after_measurement" ? measuredIds : prototypeIds).has(p.id) && !blocked.has(p.id);
                    return (
                      <option key={p.id} value={p.id} disabled={!allowed}>
                        {tp("proposal", { label: p.label ?? "" })}
                        {blocked.has(p.id) ? ` (${t("blocked")})` : ""}
                      </option>
                    );
                  })}
                </SelectField>
              ) : null}
            </div>
            <div className="mt-3">
              <TextAreaField
                label={
                  action === "select_alternative" || action === "request_changes" || PROPOSAL_ACTIONS.has(action) || riskCritical > 0
                    ? t("form.reason")
                    : t("form.comment")
                }
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={5000}
              />
            </div>
            {riskObjections.length ? (
              <div className="mt-3 rounded-xl border border-warning/60 bg-warning/10 p-3 text-sm" data-testid="risk-acceptance">
                <p className="font-medium">{t("risk.title", { n: riskObjections.length, label: proposalLabel(view, riskTarget ?? "") })}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {riskObjections.map((o) => (
                    <li key={o.id}>
                      <span className="font-medium">{severityText(o.severity)}</span>: {o.claim}
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={acceptRisk} onChange={(e) => setAcceptRisk(e.target.checked)} />
                  <span>{t("risk.accept")}</span>
                </label>
                {riskCritical ? <p className="mt-1 text-xs">{t("risk.criticalReason")}</p> : null}
                <p className="mt-1 text-[11px] text-muted">{t("risk.note")}</p>
              </div>
            ) : null}
            {error ? (
              <div className="mt-3">
                <Alert>{error}</Alert>
              </div>
            ) : null}
            <Button className="mt-3" disabled={busy || riskMissing} onClick={() => void submit()}>
              {busy ? t("form.saving") : t("form.record")}
            </Button>
          </Card>
        ) : (
          <Alert tone="warning">{t("form.onlyOwners")}</Alert>
        )
      ) : null}
    </div>
  );
}

/** Form actions that lead to a build of the named proposal and therefore need the risk acceptance (13.11.26). */
const BUILD_FORM_ACTIONS = new Set(["select_alternative", "approve_prototype", "approve_after_measurement"]);

/** Actions of the decision form that name a proposal (#249 part 2 adds favourite, prototype and after measurement). */
const PROPOSAL_ACTIONS = new Set(["select_alternative", "mark_favorite", "approve_prototype", "approve_after_measurement"]);

export { ExecutionScreen, ReviewTestsScreen } from "./execution";
