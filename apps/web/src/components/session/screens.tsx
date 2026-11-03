"use client";

import {
  CRITERIA,
  dedupeStatements,
  describeConfidenceIssue,
  objectionStatusText,
  type ConfidenceIssue,
  type Confidence,
  type Criterion,
} from "@consyrion/core/browser";
import { useState } from "react";
import { SendDecision } from "../delivery";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { buttonClasses, Button } from "../ui/button";
import { SelectField, TextAreaField } from "../ui/field";
import { CouncilNetwork } from "../dashboard/council-network";
import { Alert, Badge, Card, EmptyState } from "../ui/surface";
import { feasibilityLabel, RequirementGateTable, type RequirementGateResult } from "./requirement-gate";
import {
  contentOf,
  latestRevision,
  modelName,
  proposalLabel,
  readableFormula,
  roleLabel,
  SEVERITY_TONE,
  STATUS_TONE,
  type ProposalContent,
  type ProposalJson,
  type View,
} from "./helpers";

const CRITERION_LABELS: Record<Criterion, string> = {
  technicalQuality: "Technical quality",
  security: "Security",
  maintainability: "Maintainability",
  operatingCost: "Operating cost",
  implementationSpeed: "Implementation speed",
};

function List({ items, empty = "none" }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
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
  const status = stageStatus(view, phase);
  if (status === "running") return <EmptyState title="In progress" description={text} />;
  if (status === "failed")
    return <EmptyState title="This phase failed" description={view.stages.find((s) => s.phase === phase)?.error ?? "See the session error above."} />;
  if (status === "cancelled") return <EmptyState title="Stopped" description="The session was stopped before this phase finished." />;
  return <EmptyState title="Not started yet" description={text} />;
}

/* ---------- #39 Independent Thinking ---------- */

export function IndependentThinkingScreen({ view }: { view: View }) {
  const stage = stageStatus(view, "independent_thinking");
  const usage = view.usage.filter((u) => u.phase === "independent_thinking");
  const revealed = view.proposals.length > 0;
  return (
    <div className="space-y-4">
      <Alert tone="warning">
        Blind phase: every model receives the identical brief and works in its own request. No model sees another answer, and nobody sees any proposal until all
        models have finished. Then all proposals are revealed at once.
      </Alert>
      <Card>
        <CouncilNetwork
          centerLabel={revealed ? "Reveal" : "Blind"}
          nodes={view.participants.map((p) => {
            const rows = usage.filter((u) => u.participantId === p.id);
            const ok = rows.some((r) => r.outcome === "ok");
            const state = p.status === "failed" ? "failed" : ok ? "done" : stage === "running" ? "working" : "idle";
            return { id: p.id, label: p.provider, sublabel: p.modelId, state };
          })}
          caption="Each node is one model. Nodes float gently; a node pulses only while its request is in flight."
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
                  {state === "submitted" ? "Proposal submitted" : state === "failed" ? "Failed" : state === "working" ? "Working…" : "Waiting"}
                </Badge>
                {tokens ? <span className="text-xs text-muted">{tokens.toLocaleString("en-US")} tokens</span> : null}
              </div>
              {p.failureReason ? <p className="mt-2 text-sm text-danger">{p.failureReason}</p> : null}
            </Card>
          );
        })}
      </div>
      <p className="text-sm text-muted">
        {revealed && stage === "failed"
          ? `${view.proposals.length} of ${view.participants.length} proposals arrived – too few for a council, so no debate or verdict followed. The proposal is readable in the council room, marked as incomplete.`
          : revealed
            ? `${view.proposals.length} proposals revealed. Continue with Open Council.`
            : `${view.submittedCount} of ${view.participants.length} proposals submitted – contents stay hidden until the reveal.`}
      </p>
    </div>
  );
}

/* ---------- #40 Open Council ---------- */

function ProposalCard({ view, proposal, onOpen }: { view: View; proposal: ProposalJson; onOpen: () => void }) {
  const c = contentOf(proposal, 1);
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="primary">Proposal {proposal.label}</Badge>
        {proposal.kind === "hybrid" ? <Badge tone="accent">Hybrid</Badge> : null}
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
      <p className="mt-3 text-sm font-medium">Strengths</p>
      <List items={c.advantages.slice(0, 4)} />
      <p className="mt-3 text-sm">
        <span className="text-muted">Cost:</span> {c.costEstimate || "not provided"} · <span className="text-muted">Confidence:</span> {c.confidence} %
      </p>
      <p className="mt-1 text-xs text-muted">
        {proposal.authorParticipantId ? `Author: ${modelName(view, proposal.authorParticipantId)}` : "Author hidden until the verdict"}
      </p>
      <Button variant="secondary" className="mt-4" onClick={onOpen}>
        View full proposal
      </Button>
    </Card>
  );
}

function ProposalDetail({ view, proposal, version, onClose }: { view: View; proposal: ProposalJson; version?: number; onClose: () => void }) {
  const c = contentOf(proposal, version);
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">
          Proposal {proposal.label} – {c.title}
        </h3>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Summary</p>
          <p className="text-sm">{c.summary}</p>
          <p className="mt-3 text-sm font-medium">Architecture</p>
          <p className="whitespace-pre-wrap text-sm">{c.architecture}</p>
          <p className="mt-3 text-sm font-medium">Components</p>
          <List items={c.components} />
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Advantages</p>
            <List items={c.advantages} />
          </div>
          <div>
            <p className="text-sm font-medium">Disadvantages</p>
            <List items={c.disadvantages} />
          </div>
          <div>
            <p className="text-sm font-medium">Risks</p>
            <List items={c.risks.map((r) => `${r.risk} (${r.severity}) – mitigation: ${r.mitigation}`)} />
          </div>
          <div>
            <p className="text-sm font-medium">Assumptions</p>
            <List items={c.assumptions} />
          </div>
          <div>
            <p className="text-sm font-medium">Recommendations</p>
            <List items={c.recommendations} />
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">
        Statements are the model&apos;s own claims; they are checked in the 12 Minds Council and Minority Review.{" "}
        {proposal.authorParticipantId ? `Author: ${modelName(view, proposal.authorParticipantId)}.` : ""}
      </p>
    </Card>
  );
}

export function OpenCouncilScreen({ view }: { view: View }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<"cards" | "compare">("cards");
  const originals = view.proposals.filter((p) => p.kind === "original");
  if (!originals.length) return <Waiting view={view} phase="independent_thinking" text="Proposals appear here after the simultaneous reveal." />;
  const selected = originals.find((p) => p.id === open);
  const comparisons = view.messages.filter((m) => m.phase === "open_council" && m.kind === "comparison");
  const questions = view.messages.filter((m) => m.phase === "open_council" && m.kind === "question");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">All proposals in neutral order. No winner is declared in this phase.</p>
        <div className="flex gap-2">
          <Button variant={mode === "cards" ? "primary" : "secondary"} onClick={() => setMode("cards")}>
            Cards
          </Button>
          <Button variant={mode === "compare" ? "primary" : "secondary"} onClick={() => setMode("compare")}>
            Compare
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
                <th className="p-3">Aspect</th>
                {originals.map((p) => (
                  <th key={p.id} className="p-3">
                    Proposal {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(
                [
                  ["Title", (c: ProposalContent) => c.title],
                  ["Architecture", (c: ProposalContent) => c.architecture],
                  ["Cost", (c: ProposalContent) => c.costEstimate || "not provided"],
                  ["Risks", (c: ProposalContent) => c.risks.map((r) => `${r.risk} (${r.severity})`).join("; ") || "none stated"],
                  ["Disadvantages", (c: ProposalContent) => c.disadvantages.join("; ") || "none stated"],
                  ["Confidence", (c: ProposalContent) => `${c.confidence} %`],
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
        <h3 className="font-semibold">Common ground and differences</h3>
        {comparisons.length === 0 ? <Waiting view={view} phase="open_council" text="Each model compares all proposals." /> : null}
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {comparisons.map((m) => {
            const body = JSON.parse(m.body) as { commonGround: string[]; keyDifferences: string[] };
            return (
              <div key={m.id} className="rounded-lg border border-line p-3">
                <p className="text-xs text-muted">{modelName(view, m.participantId)}</p>
                <p className="mt-2 text-sm font-medium">Common ground</p>
                <List items={body.commonGround} />
                <p className="mt-2 text-sm font-medium">Key differences</p>
                <List items={body.keyDifferences} />
              </div>
            );
          })}
        </div>
      </Card>
      {questions.length ? (
        <Card>
          <h3 className="font-semibold">Questions and answers</h3>
          <ul className="mt-3 space-y-3">
            {questions.map((q) => {
              const answer = view.messages.find((m) => m.kind === "answer" && m.parentId === q.id);
              return (
                <li key={q.id} className="rounded-lg border border-line p-3 text-sm">
                  <p>
                    <Badge>Proposal {proposalLabel(view, q.targetProposalId)}</Badge>{" "}
                    <span className="text-muted">{modelName(view, q.participantId)} asks:</span> {q.body}
                  </p>
                  <p className="mt-2 border-l-2 border-primary/50 pl-3">{answer ? answer.body : <span className="text-muted">No answer yet.</span>}</p>
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

  return (
    <div className="space-y-5">
      <Card>
        <h3 className="font-semibold">Perspectives</h3>
        <p className="text-sm text-muted">Several perspectives on the same model are one independent voice when majorities are counted.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {view.roles.map((r) => {
            const done = preferences.some((p) => p.role === r.role);
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span>
                  {roleLabel(r.role)}
                  <span className="block text-xs text-muted">{modelName(view, r.participantId)}</span>
                </span>
                <Badge tone={done ? "success" : "neutral"}>{done ? "reviewed" : "pending"}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>
      {messages.length === 0 ? (
        <Waiting view={view} phase="twelve_minds_council" text="Each perspective reviews all proposals and names concrete, evidence-based objections." />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <SelectField label="Round" value={String(round)} onChange={(e) => setRound(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">All rounds</option>
              {rounds.map((r) => (
                <option key={r} value={r}>
                  Round {r}
                </option>
              ))}
            </SelectField>
            <SelectField label="Proposal" value={proposalFilter} onChange={(e) => setProposalFilter(e.target.value)}>
              <option value="all">All proposals</option>
              {view.proposals.map((p) => (
                <option key={p.id} value={p.id}>
                  Proposal {p.label}
                </option>
              ))}
            </SelectField>
            <p className="self-end pb-2 text-sm text-muted">
              {critiques.length} critiques · {open.length} not conceded
            </p>
          </div>
          <ul className="space-y-3">
            {critiques.map((c) => {
              const replies = messages.filter((m) => m.kind === "rebuttal" && m.parentId === c.id);
              return (
                <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="primary">Proposal {proposalLabel(view, c.targetProposalId)}</Badge>
                    <Badge tone={SEVERITY_TONE[(c.severity ?? "low") as keyof typeof SEVERITY_TONE]}>{c.severity}</Badge>
                    <Badge>{c.category}</Badge>
                    <span className="text-muted">
                      {roleLabel(c.role)} · {modelName(view, c.participantId)} · round {c.round}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{c.body}</p>
                  {c.evidence ? <p className="mt-1 text-sm text-muted">Evidence: {c.evidence}</p> : null}
                  {replies.map((r) => (
                    <div key={r.id} className="mt-3 border-l-2 border-accent/60 pl-3 text-sm">
                      <p className="text-xs text-muted">Response by the proposal&apos;s author {r.evidence === "concedes" ? "· concedes the point" : ""}</p>
                      <p>{r.body}</p>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
          <Card>
            <h3 className="font-semibold">Current preferences</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {preferences.map((p) => (
                <li key={p.id}>
                  <span className="text-muted">{roleLabel(p.role)}:</span> Proposal {proposalLabel(view, p.targetProposalId)} – {p.body}
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
  if (!changed.length) return <p className="text-sm text-muted">No content changes.</p>;
  const show = (value: unknown) => (Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("\n") : String(value));
  return (
    <div className="space-y-3">
      {changed.map((k) => (
        <div key={k} className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-danger/30 bg-danger/5 p-2 text-sm">
            <p className="text-xs text-muted">{k} – before</p>
            <p className="whitespace-pre-wrap">{show(before[k])}</p>
          </div>
          <div className="rounded-lg border border-success/30 bg-success/5 p-2 text-sm">
            <p className="text-xs text-muted">{k} – after</p>
            <p className="whitespace-pre-wrap">{show(after[k])}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MinorityConsensusScreen({ view }: { view: View }) {
  const [section, setSection] = useState<"minority" | "consensus">("minority");
  const [proposalId, setProposalId] = useState<string | null>(view.proposals[0]?.id ?? null);
  const review = view.minorityReview;
  const proposal = view.proposals.find((p) => p.id === proposalId);
  return (
    <div className="space-y-5">
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
          <Waiting view={view} phase="minority_review" text="Dissenting objections are reviewed separately before any consensus is formed." />
        ) : (
          <>
            {review ? (
              <Card>
                <p className="text-sm">
                  Favoured so far:{" "}
                  <strong>{review.favoredProposalId ? `Proposal ${proposalLabel(view, review.favoredProposalId)}` : "no clear favourite"}</strong>
                  {review.favoredProposalId ? ` (${review.majorityModelCount} of ${review.independentModelCount} independent models)` : ""}.{" "}
                  {review.reevaluationTriggered ? <Badge tone="warning">Well-founded dissent triggered a re-evaluation</Badge> : null}
                </p>
              </Card>
            ) : null}
            {view.objections.length === 0 ? <p className="text-sm text-muted">No substantiated objections were raised.</p> : null}
            <ul className="space-y-3">
              {view.objections.map((o) => (
                <li key={o.id} className="rounded-xl border border-line bg-surface p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="primary">Proposal {proposalLabel(view, o.proposalId)}</Badge>
                    <Badge tone={SEVERITY_TONE[o.severity]}>{o.severity}</Badge>
                    <Badge>{o.category}</Badge>
                    <Badge tone={STATUS_TONE[o.status]}>{objectionStatusText(o.status)}</Badge>
                    {o.blocking ? <Badge tone="danger">Blocks approval</Badge> : null}
                    <span className="text-muted">raised by {modelName(view, o.raisedByParticipantId)}</span>
                  </div>
                  <p className="mt-2">Objection: {o.claim}</p>
                  {o.evidence ? <p className="mt-1 text-muted">Evidence: {o.evidence}</p> : null}
                  <p className="mt-2 border-l-2 border-accent/60 pl-3">
                    <span className="text-xs text-muted">Response of the favoured approach</span>
                    <br />
                    {o.response ??
                      (o.undefendedReason
                        ? `Not defended – ${o.undefendedReason}. The author could not answer; this is not uncontested criticism.`
                        : "No response.")}
                  </p>
                  {o.resolutionReason ? (
                    <p className="mt-2 text-muted">
                      Independent review{o.reviewedByParticipantId ? ` (${modelName(view, o.reviewedByParticipantId)})` : ""}: {o.resolutionReason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )
      ) : !view.consensus ? (
        <Waiting view={view} phase="consensus_round" text="Models may revise their proposals, keep their position or adopt ideas. Consensus is not required." />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Result:</span>
              <Badge tone={view.consensus.status === "consensus" ? "success" : view.consensus.status === "partial" ? "warning" : "neutral"}>
                {view.consensus.status.replace("_", " ")}
              </Badge>
              {view.consensus.basedOn?.length ? (
                <span className="text-sm text-muted">Based on {view.consensus.basedOn.map((r) => `${r.label} v${r.version}`).join(" · ")}</span>
              ) : null}
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-sm font-medium">Agreements</p>
                <List items={view.consensus.agreements} />
              </div>
              <div>
                <p className="text-sm font-medium">Remaining disagreements</p>
                <List items={view.consensus.disagreements} />
              </div>
              <div>
                <p className="text-sm font-medium">Outstanding risks</p>
                <List items={view.consensus.outstandingRisks} />
              </div>
            </div>
          </Card>
          <div className="flex flex-wrap gap-2">
            {view.proposals.map((p) => (
              <Button key={p.id} variant={p.id === proposalId ? "primary" : "secondary"} onClick={() => setProposalId(p.id)}>
                Proposal {p.label}
                {p.kind === "hybrid" ? " (hybrid)" : ""} · v{latestRevision(p).version}
              </Button>
            ))}
          </div>
          {proposal ? (
            <Card>
              <h3 className="font-semibold">
                Proposal {proposal.label}: version 1 → version {latestRevision(proposal).version}
              </h3>
              <div className="mt-3 space-y-3">
                {proposal.revisions.slice(1).map((r) => (
                  <div key={r.id} className="text-sm">
                    <p className="font-medium">
                      Version {r.version} {r.keptPosition ? <Badge>position kept</Badge> : null}
                    </p>
                    <List
                      items={(r.changes as Array<{ change?: string; reason?: string; motivatedBy?: string[] }>).map(
                        (c) => `${c.change ?? ""}${c.reason ? ` – ${c.reason}` : ""}${c.motivatedBy?.length ? ` (refs: ${c.motivatedBy.length})` : ""}`,
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

const FAILURE_TEXT: Record<string, string> = {
  invalid_output: "answer did not match the required structure",
  max_tokens: "answer was cut off at the output limit",
  refusal: "model declined to answer",
  error: "provider call failed",
  not_run: "no evaluation was run",
};

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
  if (issues.length === 0 && failed.length === 0) return null;
  const level = matrix.confidence ?? "low";
  const label = (id: string) => proposalLabel(view, id);
  return (
    <Alert tone="warning">
      <p className="font-medium">
        {level === "reduced" ? "Limited review depth – this verdict rests on a small council." : "Low confidence – read this verdict with care."}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {failed.map((f) => (
          <li key={f.participantId}>
            {f.modelId} could not evaluate ({FAILURE_TEXT[f.outcome] ?? f.outcome}); its scores and vote are missing.
          </li>
        ))}
        {issues.map((issue, index) => (
          <li key={`${issue.kind}-${index}`}>{describeConfidenceIssue(issue, label)}.</li>
        ))}
      </ul>
      {level === "low" ? (
        <p className="mt-1">
          {matrix.requirementGate
            ? "Missing evaluations can be fetched with “Repeat the evaluation” while a model is still available; otherwise change the brief or the requirements and start a new council."
            : "Consider “Request more debate” to re-run the missing evaluations, or compare the alternatives before approving."}
        </p>
      ) : null}
    </Alert>
  );
}

/**
 * #230: the first thing to read when a council ends without a recommendation because an evaluation is missing – a
 * technical gap, not a finding about the proposals – and the next step that is actually available.
 */
function MainReason({ view, matrix, canRepeat }: { view: View; matrix: DecisionMatrix; canRepeat: boolean }) {
  const failed = matrix.failedEvaluators ?? [];
  if (failed.length === 0 || view.decision?.outcome === "recommended") return null;
  const names = failed.map((f) => `${f.modelId} (${FAILURE_TEXT[f.outcome] ?? f.outcome})`).join(", ");
  const open = (matrix.requirementGate?.proposals ?? []).filter((g) => g.feasibility === "needs_verification").length;
  return (
    <div className="mt-3 rounded-lg border border-warning/50 p-3 text-sm" data-testid="main-reason">
      <p>
        <span className="font-medium">Main reason: the evaluation is incomplete.</span> {names} could not finish its check
        {open ? `, so ${open} proposal${open === 1 ? "" : "s"} could not be confirmed` : ""}. This is a technical gap, not a finding that a proposal fails a
        requirement.
      </p>
      <p className="mt-1 text-muted">
        Next step: {canRepeat ? "“Repeat the evaluation” below asks only the missing model again, with your API key and within this council's budget. " : ""}
        If it fails again, start a new council – for example with fewer requirements or another model.
      </p>
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
  if (!matrix)
    return (
      <Waiting view={view} phase="final_verdict" text="Every model scores all proposals except its own. The matrix is computed from those stored scores." />
    );
  // A matrix of a format this version does not know (#181): the server says so; nothing is guessed from it.
  if (view.decisionStatus && !view.decisionStatus.readable) return <EmptyState title="Evaluation not shown" description={view.decisionStatus.reason ?? ""} />;
  const ordered = [...matrix.proposals].sort((a, b) => proposalLabel(view, a.proposalId).localeCompare(proposalLabel(view, b.proposalId)));
  const drillProposal = view.proposals.find((p) => p.id === drill);
  const drillScores = drillProposal ? view.scores.filter((s) => s.revisionId === latestRevision(drillProposal).id) : [];
  return (
    <div className="space-y-5">
      <ConfidenceNotice view={view} matrix={matrix as DecisionMatrix} recommendedProposalId={view.decision?.recommendedProposalId ?? null} />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="p-3 text-left text-muted">Mean of independent scores (0–10); ± shows the spread between evaluators.</caption>
          <thead className="bg-surface-2">
            <tr>
              <th className="p-3">Criterion (weight)</th>
              {ordered.map((p) => (
                <th key={p.proposalId} className="p-3">
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => setDrill(p.proposalId)}>
                    Proposal {proposalLabel(view, p.proposalId)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {CRITERIA.map((criterion) => (
              <tr key={criterion}>
                <th className="p-3 font-medium">
                  {CRITERION_LABELS[criterion]} ({matrix.weights[criterion]} %)
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
              <th className="p-3">Weighted total</th>
              {ordered.map((p) => (
                <td key={p.proposalId} className="p-3">
                  {p.total ?? "–"}
                </td>
              ))}
            </tr>
            <tr>
              <th className="p-3 font-medium">Meets the hard requirements</th>
              {ordered.map((p) => (
                <td key={p.proposalId} className="p-3">
                  {matrix.requirementGate ? (
                    (() => {
                      const entry = matrix.requirementGate.proposals.find((g) => g.proposalId === p.proposalId);
                      const label = entry ? feasibilityLabel(entry) : { text: "not evaluated", tone: "danger" as const };
                      return <Badge tone={label.tone}>{label.text}</Badge>;
                    })()
                  ) : p.implementable === false ? (
                    <Badge tone="danger">no – finding, not a solution</Badge>
                  ) : (
                    <Badge tone="success">yes</Badge>
                  )}
                  {!matrix.requirementGate && p.requirementChecks?.total ? (
                    <span className="mt-1 block text-xs text-muted">
                      {p.requirementChecks.total - p.requirementChecks.failed} of {p.requirementChecks.total} independent evaluators: met
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
            <tr>
              <th className="p-3 font-medium">Gates</th>
              {ordered.map((p) => (
                <td key={p.proposalId} className="p-3">
                  {p.eligible ? <Badge tone="success">eligible</Badge> : <Badge tone="danger">not eligible</Badge>}
                  {p.ineligibleReasons.map((r) => (
                    <span key={r} className="mt-1 block text-xs text-danger">
                      {r}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
            <tr>
              <th className="p-3 font-medium">Independent evaluators / vote points</th>
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
        Formula: {readableFormula(view, matrix.formula)}. Majority vote (for information only – it never overrides the requirement check):{" "}
        {matrix.majorityVoteWinnerId ? `Proposal ${proposalLabel(view, matrix.majorityVoteWinnerId)}` : "no clear majority"}.
      </p>
      {matrix.requirementGate ? <RequirementGateTable view={view} gate={matrix.requirementGate} /> : null}
      {drillProposal ? (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Scores for Proposal {drillProposal.label}</h3>
            <Button variant="ghost" onClick={() => setDrill(null)}>
              Close
            </Button>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {drillScores.map((s) => (
              <li key={s.id}>
                <Badge>{CRITERION_LABELS[s.criterion as Criterion] ?? s.criterion}</Badge> <strong>{s.score}/10</strong>{" "}
                <span className="text-muted">
                  by {modelName(view, s.evaluatorParticipantId)}
                  {weightsDiffer(view) ? ` (vote weight ${view.participants.find((p) => p.id === s.evaluatorParticipantId)?.voteWeight ?? 1}/10)` : ""}
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
  if (!p || p.percent === null) return null;
  return (
    <p className="text-sm text-muted" data-testid="valid-participation">
      Valid participation:{" "}
      <strong className={p.valid === p.total ? "text-text" : "text-warning"}>
        {p.valid}/{p.total}
      </strong>{" "}
      ({p.percent} %)
      {p.shortfalls.length
        ? ` – short: ${p.shortfalls.map((s) => `${modelName(view, s.participantId)} (${s.phases.length ? s.phases.join(", ") : "no valid contribution"})`).join(", ")}`
        : " – every model delivered in every phase it was called in."}
    </p>
  );
}

const OUTCOME: Record<string, { title: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  recommended: { title: "Recommended solution", tone: "success" },
  tie: { title: "Tie – please choose", tone: "warning" },
  // #230: about the proposals of this council, never about every possible solution.
  no_qualifying_solution: { title: "None of the proposals meets the requirements", tone: "danger" },
  insufficient_evidence: { title: "Insufficient independent evidence", tone: "warning" },
};

export function VerdictScreen({ view, canApprove, onChange }: { view: View; canApprove: boolean; onChange: () => Promise<void> }) {
  const decision = view.decision;
  // Approvability comes from the server (#181, stage 1); this screen only displays it and never re-checks the format.
  const status = view.decisionStatus;
  const readable = status?.readable ?? false;
  const notApprovable = status ? !status.approvable : false;
  const matrix = readable ? (decision?.matrix as unknown as DecisionMatrix | undefined) : undefined;
  // The council found that the hard requirements conflict (#121): the only decisions are confirming the finding
  // (reject, no build), more debate or a changed brief – never an implementation approval.
  const conflict = !notApprovable && matrix?.requirementsConflict === true;
  // Gate version 2 (#181, S1): no extra debate (it would discard the stored checks); the way on is a new council.
  const s1 = status?.gateVersion === 2;
  // Without a recommendation (tie, no qualifying solution) approving it is impossible – start with choosing one.
  // Evaluators without usable scores can be asked again; scores already given stay (#145).
  const missingEvaluators = (matrix?.failedEvaluators ?? []).length;
  const [action, setAction] = useState(
    notApprovable
      ? missingEvaluators > 0
        ? "repeat_evaluation"
        : "request_changes"
      : decision?.outcome === "recommended" && status?.canApproveRecommendation
        ? "approve"
        : (decision?.outcome === "insufficient_evidence" || decision?.outcome === "needs_verification") && missingEvaluators > 0
          ? "repeat_evaluation"
          : conflict
            ? "reject"
            : "select_alternative",
  );
  const [comment, setComment] = useState("");
  const [alternative, setAlternative] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!decision)
    return <Waiting view={view} phase="final_verdict" text="The verdict is computed deterministically from independent scores, gates and objections." />;
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
  // #249: a proposal passed every check but too few independent evaluators took part – say so in the title.
  const provisional = (matrix?.requirementGate?.proposals ?? []).some((g) => g.limitedReview);
  const outcome = notApprovable
    ? {
        title: provisional
          ? "Provisional favourite – limited review, not approvable"
          : decision.outcome === "needs_verification"
            ? "Needs verification – not approvable"
            : "Not approvable",
        tone: "warning" as const,
      }
    : conflict
      ? { title: "No solution can meet these requirements", tone: "danger" as const }
      : (OUTCOME[decision.outcome] ?? { title: "Not approvable", tone: "warning" as const });
  const findings = new Set((matrix?.proposals ?? []).filter((p) => p.implementable === false).map((p) => p.proposalId));
  const approvableIds = new Set(status?.approvableProposalIds ?? []);
  const notImplementable = new Set(view.proposals.filter((p) => !approvableIds.has(p.id)).map((p) => p.id));
  const notApprovableText = (id: string) =>
    s1 ? "does not meet all confirmed requirements" : findings.has(id) ? "finding, not an implementable solution" : "not approvable";
  // The same conflict named by several proposals is listed once (#173).
  const conflicts = dedupeStatements(view.proposals.flatMap((p) => contentOf(p).requirementConflicts ?? []));
  const total = (proposalId: string) => (matrix as { proposals?: MatrixProposal[] } | undefined)?.proposals?.find((p) => p.proposalId === proposalId)?.total;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/sessions/${view.session.id}/approval`, {
        method: "POST",
        body: JSON.stringify({ action, comment, selectedProposalId: action === "select_alternative" ? alternative : undefined }),
      });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not record the decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {matrix ? <ConfidenceNotice view={view} matrix={matrix} recommendedProposalId={decision.recommendedProposalId} /> : null}
      <ValidParticipation view={view} />
      {weightsDiffer(view) ? (
        <p className="text-sm text-muted">
          Vote weights (fixed at the start, #140): {view.participants.map((p) => `${modelName(view, p.id)} ${p.voteWeight}/10`).join(" · ")}. Weighted are each
          model&apos;s scores and ranking, not its own proposal; the feasibility check counts every model once.
        </p>
      ) : null}
      <Card className={outcome.tone === "success" ? "border-success/50" : outcome.tone === "danger" ? "border-danger/50" : ""}>
        <Badge tone={outcome.tone}>{outcome.title}</Badge>
        {matrix ? <MainReason view={view} matrix={matrix} canRepeat={canApprove} /> : null}
        {notApprovable && status?.reason ? (
          <p className="mt-3 text-sm" data-testid="not-approvable-reason">
            {status.reason} You can request changes to the brief or reject; a changed brief needs a new council.
          </p>
        ) : null}
        {s1 && matrix?.requirementGate ? (
          <div className="mt-3 text-sm">
            {matrix.requirementGate.summary ? <p>{matrix.requirementGate.summary}</p> : null}
            {(() => {
              // Requirements confirmed, but another gate (security minimum, minimum score, blocking objection) failed –
              // not the same as unmet requirements (#181 review).
              const otherGate = matrix.requirementGate.proposals.filter(
                (g) => g.feasibility === "qualified" && matrix.proposals.find((p) => p.proposalId === g.proposalId)?.eligible === false,
              );
              return otherGate.length ? (
                <p className="mt-1">
                  {otherGate.map((g) => `Proposal ${proposalLabel(view, g.proposalId)}`).join(", ")} meet
                  {otherGate.length === 1 ? "s" : ""} the confirmed requirements but did not pass another gate (security minimum, minimum score or a blocking
                  objection) – see Evaluation.
                </p>
              ) : null;
            })()}
            {matrix.requirementGate.comparisonNote ? <p className="mt-1">{matrix.requirementGate.comparisonNote}</p> : null}
            <ul className="mt-1 list-disc pl-5 text-muted">
              {matrix.requirementGate.proposals.map((g) => (
                <li key={g.proposalId}>
                  Proposal {proposalLabel(view, g.proposalId)}: {feasibilityLabel(g).text}
                  {g.causes.length ? ` – ${g.causes[0]}${g.causes.length > 1 ? ` (+${g.causes.length - 1} more)` : ""}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted">
              Details per requirement and evaluator: Evaluation. These are model judgements with reasons, not a fact check.
            </p>
          </div>
        ) : null}
        {recommended && content ? (
          <>
            <h2 className="mt-3 text-xl font-semibold">
              Proposal {recommended.label} – {content.title}
            </h2>
            <p className="text-sm text-muted">
              by {modelName(view, recommended.authorParticipantId)} · weighted total {total(recommended.id)} / 10
            </p>
            {change?.changed ? (
              <p className="mt-2 text-sm text-warning">
                Architecture change: revision v{recommended.revisions.at(-1)?.version} replaced the solution of v1
                {change.adoptedFrom.length ? ` and resembles Proposal ${change.adoptedFrom.join(", ")}` : ""} – the content is not only the author&apos;s own.
              </p>
            ) : null}
            <p className="mt-3 text-sm">{content.summary}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-sm font-medium">Main strengths</p>
                <List items={content.advantages} />
              </div>
              <div>
                <p className="text-sm font-medium">Main weaknesses</p>
                <List items={content.disadvantages} />
              </div>
              <div>
                <p className="text-sm font-medium">Remaining risks</p>
                <List
                  items={[
                    ...content.risks.map((r) => `${r.risk} (${r.severity}; mitigation: ${r.mitigation})`),
                    ...openObjections.current.map((o) => `${o.claim} (${o.status} objection)`),
                  ]}
                />
              </div>
            </div>
            {openObjections.moot.length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">
                  {openObjections.moot.length} objection{openObjections.moot.length === 1 ? "" : "s"} against an earlier revision no longer apply
                </summary>
                <List
                  items={openObjections.moot.map(
                    (o) => `${o.claim} – raised against v${o.againstVersion}; no longer applies to v${o.currentVersion} (not independently re-reviewed)`,
                  )}
                />
              </details>
            ) : null}
          </>
        ) : conflict ? (
          <>
            <p className="mt-3 text-sm">
              The proposals conclude, and the independent evaluators confirm, that the hard requirements cannot be met together. A good analysis of that is not
              a solution: nothing can be built under these requirements. Confirm the finding with “Reject” (no build), or change the requirements – a changed
              brief needs a new council and a new approval.
            </p>
            {conflicts.length ? (
              <div className="mt-3">
                <p className="text-sm font-medium">Conflicting requirements</p>
                <List items={conflicts} />
              </div>
            ) : null}
          </>
        ) : notApprovable ? null : (
          <p className="mt-3 text-sm">
            {decision.outcome === "tie"
              ? "The leading proposals are too close to call. Choose an alternative with a reason, or request more debate."
              : "The council could not recommend a solution. You can request more debate, request changes to the brief or reject."}
          </p>
        )}
      </Card>

      <Card>
        {/* Objections, not minority opinions (#169): the badge says how the objection was decided, not the proposal. */}
        <h3 className="font-semibold">Objections (Minority Review)</h3>
        {view.objections.length === 0 ? (
          <p className="text-sm text-muted">No objections were raised.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {view.objections.map((o) => (
              <li key={o.id}>
                <Badge tone={STATUS_TONE[o.status]}>{objectionStatusText(o.status)}</Badge> Objection by {modelName(view, o.raisedByParticipantId)} against
                Proposal {proposalLabel(view, o.proposalId)} ({o.category}/{o.severity}): {o.claim}
                {o.blocking ? <span className="text-danger"> – blocks approval</span> : null}
                {o.evidence ? <span className="block text-muted">Reasoning: {o.evidence}</span> : null}
                {o.resolutionReason ? <span className="block text-muted">Decision: {o.resolutionReason}</span> : null}
                {o.undefendedReason && !o.response ? <span className="text-warning"> – not defended ({o.undefendedReason})</span> : null}
              </li>
            ))}
          </ul>
        )}
        {view.consensus?.disagreements.length ? (
          <p className="mt-2 text-xs text-muted">Disagreements that remain between the models are shown in the Consensus Round.</p>
        ) : null}
      </Card>

      <Card>
        <h3 className="font-semibold">Alternatives</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {view.proposals
            .filter((p) => p.id !== decision.recommendedProposalId)
            .map((p) => (
              <li key={p.id}>
                <strong>Proposal {p.label}</strong> – {contentOf(p).title} ({total(p.id) ?? "–"} / 10)
                {blocked.has(p.id) ? <span className="text-danger"> – blocked</span> : null}
                {notImplementable.has(p.id) ? <span className="text-danger"> – {notApprovableText(p.id)}</span> : null}
                <span className="block text-muted">{contentOf(p).summary}</span>
              </li>
            ))}
        </ul>
      </Card>

      <div className="flex flex-wrap gap-2">
        <a className={buttonClasses("primary")} href={`/api/sessions/${view.session.id}/report?format=pdf`}>
          Download PDF
        </a>
        <a className={buttonClasses("secondary")} href={`/api/sessions/${view.session.id}/report?format=docx`}>
          Download Word
        </a>
        <a className={buttonClasses("secondary")} href={`/api/sessions/${view.session.id}/report`}>
          Export report (Markdown)
        </a>
        <a className={buttonClasses("secondary")} href={`/api/sessions/${view.session.id}/report?format=json`}>
          Export report (JSON)
        </a>
      </div>

      <SendDecision sessionId={view.session.id} projectDefault={view.project.deliveryDefault ?? null} />

      {view.approvals.length ? (
        <Card>
          <h3 className="font-semibold">Decision history</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {view.approvals.map((a) => (
              <li key={a.id}>
                {new Date(a.createdAt).toLocaleString("en-GB")} – {a.action.replaceAll("_", " ")}
                {a.comment ? `: ${a.comment}` : ""}
              </li>
            ))}
          </ul>
          {view.previousDecisions.length ? (
            <p className="mt-2 text-xs text-muted">{view.previousDecisions.length} earlier verdict(s) were superseded by additional debate.</p>
          ) : null}
        </Card>
      ) : null}

      {view.session.status === "awaiting_approval" ? (
        canApprove ? (
          <Card>
            <h3 className="font-semibold">Your decision</h3>
            <p className="text-sm text-muted">
              Nothing is developed without your approval. Proposals blocked by a critical security objection, and findings that the requirements cannot be met,
              cannot be approved for implementation.
            </p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <SelectField label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="approve" disabled={!status?.canApproveRecommendation}>
                  Approve recommendation
                </option>
                <option value="select_alternative" disabled={conflict || notApprovable}>
                  Select an alternative
                </option>
                <option value="repeat_evaluation" disabled={missingEvaluators === 0}>
                  Repeat the evaluation ({missingEvaluators} model{missingEvaluators === 1 ? "" : "s"} without scores)
                </option>
                {s1 ? null : <option value="request_more_debate">Request more debate</option>}
                <option value="request_changes">
                  {s1 ? "Request changes – then edit the brief or requirements and start a new council" : "Request changes"}
                </option>
                <option value="reject">{conflict ? "Reject – confirm the finding, no build" : "Reject"}</option>
              </SelectField>
              {action === "select_alternative" ? (
                <SelectField label="Proposal" value={alternative} onChange={(e) => setAlternative(e.target.value)}>
                  <option value="">Choose…</option>
                  {view.proposals.map((p) => (
                    <option key={p.id} value={p.id} disabled={blocked.has(p.id) || notImplementable.has(p.id)}>
                      Proposal {p.label}
                      {blocked.has(p.id) ? " (blocked)" : notImplementable.has(p.id) ? ` (${notApprovableText(p.id)})` : ""}
                    </option>
                  ))}
                </SelectField>
              ) : null}
            </div>
            <div className="mt-3">
              <TextAreaField
                label={action === "select_alternative" || action === "request_changes" ? "Reason (required)" : "Comment (optional)"}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={5000}
              />
            </div>
            {error ? (
              <div className="mt-3">
                <Alert>{error}</Alert>
              </div>
            ) : null}
            <Button className="mt-3" disabled={busy} onClick={() => void submit()}>
              {busy ? "Saving…" : "Record decision"}
            </Button>
          </Card>
        ) : (
          <Alert tone="warning">Only owners and admins can approve decisions.</Alert>
        )
      ) : null}
    </div>
  );
}

export { ExecutionScreen, ReviewTestsScreen } from "./execution";
