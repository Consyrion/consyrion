"use client";

import {
  countLimits,
  describeMeasure,
  detectMeasure,
  measurableOnlyAfterImplementation,
  measurementPlanSuggestion,
  type RequirementMeasure,
} from "@consyrion/core/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { control } from "./ui/field";
import { Alert, Badge, Card } from "./ui/surface";

/**
 * Requirement intake (#190): the user reviews the server's proposal of hard requirements, edits, adds, removes or
 * excludes items and confirms. No extraction happens here – the proposal comes from the server, which also checks
 * the confirmation again. A council starts only on a confirmed list that matches the current brief and documents.
 */

export interface IntakeSource {
  kind: "requirements" | "goal" | "idea" | "document" | "user";
  documentId?: string;
  documentName?: string;
}

export interface IntakeProposal {
  source: { hash: string; briefVersion: number; documents: Array<{ id: string; name: string }> };
  current: boolean;
  latest: {
    version: number;
    items: Array<{ id: string; text: string; measure?: RequirementMeasure | null }>;
    excluded: Array<{ text: string; reason: string }>;
    noHardRequirements: boolean;
    briefVersion: number;
    confirmedAt: string;
  } | null;
  items: Array<{ text: string; candidateKey: string | null; source: IntakeSource; isNew: boolean; sourceGone: boolean }>;
  excluded: Array<{ candidateKey: string; text: string; source: IntakeSource; reason: string }>;
  /** #227: statements that read like instructions to the models or rules about the evaluation – the user decides. */
  toDecide?: Array<{ candidateKey: string; text: string; source: IntakeSource; suspicion: Suspicion; suggestedReason: string }>;
  unscannedDocuments: Array<{ id: string; name: string }>;
  /** Images without a confirmed description: the list cannot be confirmed yet (docs/documents.md). */
  pendingImages?: string[];
  notProposed: number;
}

type Suspicion = "instruction" | "quoted_instruction" | "meta_rule";

const SUSPICION_TEXT: Record<Suspicion, string> = {
  instruction: "Reads like an instruction to the AI models (e.g. to ignore rules or to rate a proposal). The models never follow it.",
  quoted_instruction:
    "Quotes text that reads like an instruction to the AI models. If the product must handle this text as data (store, show, filter it), keep it – the models check it as a requirement and never follow the quoted text.",
  meta_rule:
    "Says when a requirement counts as met instead of describing the product. The council judges every proposal on substance; keep it only if it is a real product rule.",
};

interface Row {
  uid: string;
  text: string;
  candidateKey: string | null;
  source: IntakeSource;
  isNew: boolean;
  sourceGone: boolean;
}

const SOURCE_LABELS: Record<IntakeSource["kind"], string> = {
  requirements: "Requirements",
  goal: "Desired outcome",
  idea: "Idea",
  document: "Document",
  user: "Added by you",
};

function sourceLabel(source: IntakeSource) {
  return source.kind === "document" && source.documentName ? `Document: ${source.documentName}` : SOURCE_LABELS[source.kind];
}

let counter = 0;
const uid = () => `row-${++counter}`;

export function RequirementIntake({ projectId, proposal, canWrite }: { projectId: string; proposal: IntakeProposal; canWrite: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!proposal.current);
  const [rows, setRows] = useState<Row[]>(() => proposal.items.map((i) => ({ ...i, uid: uid() })));
  const [excluded, setExcluded] = useState(proposal.excluded);
  const [toDecide, setToDecide] = useState(proposal.toDecide ?? []);
  const [noHard, setNoHard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addRequirement = (text: string) =>
    setRows((r) => [...r, { uid: uid(), text, candidateKey: null, source: { kind: "user" }, isNew: true, sourceGone: false }]);
  const update = (key: string, text: string) => setRows((r) => r.map((row) => (row.uid === key ? { ...row, text } : row)));
  const remove = (row: Row) => {
    setRows((r) => r.filter((x) => x.uid !== row.uid));
    // A proposed statement is never dropped silently: it moves to "not taken over" and needs a reason.
    if (row.candidateKey) setExcluded((e) => [...e, { candidateKey: row.candidateKey!, text: row.text, source: row.source, reason: "" }]);
  };
  const keep = (candidateKey: string) => {
    const entry = excluded.find((e) => e.candidateKey === candidateKey);
    if (!entry) return;
    setExcluded((e) => e.filter((x) => x.candidateKey !== candidateKey));
    setRows((r) => [...r, { uid: uid(), text: entry.text, candidateKey, source: entry.source, isNew: false, sourceGone: false }]);
  };

  const decide = (candidateKey: string, keepIt: boolean) => {
    const entry = toDecide.find((e) => e.candidateKey === candidateKey);
    if (!entry) return;
    setToDecide((all) => all.filter((x) => x.candidateKey !== candidateKey));
    if (keepIt) setRows((r) => [...r, { uid: uid(), text: entry.text, candidateKey, source: entry.source, isNew: false, sourceGone: false }]);
    else setExcluded((e) => [...e, { candidateKey, text: entry.text, source: entry.source, reason: entry.suggestedReason }]);
  };

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/projects/${projectId}/requirements`, {
        method: "POST",
        body: JSON.stringify({
          sourceHash: proposal.source.hash,
          items: rows.map((r) => ({ text: r.text, candidateKey: r.candidateKey })),
          excluded: excluded.map((e) => ({ candidateKey: e.candidateKey, reason: e.reason })),
          noHardRequirements: rows.length === 0 ? noHard : undefined,
        }),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not confirm the requirements");
    } finally {
      setBusy(false);
    }
  }

  const latest = proposal.latest;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Hard requirements</h2>
          <p className="mt-1 text-sm text-muted">
            The council checks every proposal against exactly this list. Review it before the start – the number of sentences in the brief is no proof that
            nothing is missing.
          </p>
        </div>
        {proposal.current && latest ? (
          <Badge tone="success">Version {latest.version} confirmed</Badge>
        ) : (
          <Badge tone="warning">{latest ? "Needs confirmation again" : "Not confirmed yet"}</Badge>
        )}
      </div>

      {!proposal.current && latest ? (
        <div className="mt-3">
          <Alert tone="warning">
            The brief or its documents changed after version {latest.version} was confirmed (brief version {latest.briefVersion}). Review the list and confirm
            it again before starting a council. Councils that already run keep the list they were started with.
          </Alert>
        </div>
      ) : null}

      {!editing && latest ? (
        <div className="mt-4 space-y-3 text-sm">
          {latest.items.length === 0 ? (
            <p className="text-muted">Confirmed: this brief has no hard requirements.</p>
          ) : (
            <ol className="space-y-1">
              {latest.items.map((item) => (
                <li key={item.id} className="flex gap-2">
                  <span className="font-mono text-xs text-muted">{item.id}</span>
                  <span>
                    {item.text}
                    {item.measure ? (
                      <span className="ml-2 inline-block">
                        <Badge tone="accent">estimated by the models: {describeMeasure(item.measure)}</Badge>
                      </span>
                    ) : countLimits(item.text) > 1 ? (
                      <span className="ml-2 inline-block">
                        <Badge tone="warning">several limits – not checked as numbers</Badge>
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {latest.excluded.length ? (
            <details>
              <summary className="cursor-pointer text-muted">{latest.excluded.length} statement(s) deliberately not taken over</summary>
              <ul className="mt-2 space-y-1">
                {latest.excluded.map((e, i) => (
                  <li key={i}>
                    <span className="line-through">{e.text}</span> <span className="text-muted">– {e.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {canWrite ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit requirements
            </Button>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div className="mt-4 space-y-4">
          <ol className="space-y-2">
            {rows.map((row, index) => (
              <li key={row.uid} className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-mono">R{index + 1}</span>
                  <span>{sourceLabel(row.source)}</span>
                  {row.isNew ? <Badge tone="primary">new</Badge> : null}
                  {row.sourceGone ? <Badge tone="warning">source no longer in the brief</Badge> : null}
                  <MeasureHint text={row.text} />
                </div>
                {measurableOnlyAfterImplementation(row.text) ? (
                  <AfterImplementationHint
                    text={row.text}
                    planned={rows.some((r) => r.text === measurementPlanSuggestion(row.text))}
                    onAdd={canWrite ? () => addRequirement(measurementPlanSuggestion(row.text)) : undefined}
                  />
                ) : null}
                <div className="flex gap-2">
                  <textarea
                    aria-label={`Requirement R${index + 1}`}
                    value={row.text}
                    disabled={!canWrite}
                    onChange={(e) => update(row.uid, e.target.value)}
                    className={`${control} min-h-12`}
                  />
                  {canWrite ? (
                    <Button variant="ghost" className="px-2" onClick={() => remove(row)} aria-label={`Remove R${index + 1}`}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {canWrite ? (
            <Button variant="secondary" onClick={() => addRequirement("")}>
              Add requirement
            </Button>
          ) : null}

          {toDecide.length ? (
            <div role="region" aria-label="Statements to decide">
              <h3 className="text-sm font-medium">Please decide ({toDecide.length})</h3>
              <p className="mt-1 text-xs text-muted">
                Nothing is kept or removed here on its own. Decide each statement before you confirm; the original wording stays unchanged.
              </p>
              <ul className="mt-2 space-y-2">
                {toDecide.map((entry) => (
                  <li key={entry.candidateKey} className="rounded-lg border border-warning/50 p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{sourceLabel(entry.source)}</span>
                      <Badge tone="warning">please check</Badge>
                    </div>
                    <p>{entry.text}</p>
                    <p className="mt-1 text-xs text-muted">{SUSPICION_TEXT[entry.suspicion]}</p>
                    {canWrite ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => decide(entry.candidateKey, true)}>
                          Keep as requirement
                        </Button>
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => decide(entry.candidateKey, false)}>
                          Not a requirement
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {excluded.length ? (
            <div>
              <h3 className="text-sm font-medium">Not taken over</h3>
              <p className="mt-1 text-xs text-muted">
                These statements from the brief or a document are not binding. Give a reason for each; they are shown to the council as excluded, so they do not
                come back as requirements.
              </p>
              <ul className="mt-2 space-y-2">
                {excluded.map((entry) => (
                  <li key={entry.candidateKey} className="rounded-lg border border-line p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted">{sourceLabel(entry.source)}</span>
                      {canWrite ? (
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => keep(entry.candidateKey)}>
                          Keep as requirement
                        </Button>
                      ) : null}
                    </div>
                    <p className="line-through">{entry.text}</p>
                    <input
                      aria-label="Reason for not taking it over"
                      placeholder="Reason (required)"
                      value={entry.reason}
                      disabled={!canWrite}
                      onChange={(e) => setExcluded((all) => all.map((x) => (x.candidateKey === entry.candidateKey ? { ...x, reason: e.target.value } : x)))}
                      className={`${control} mt-2`}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {proposal.pendingImages?.length ? (
            <Alert tone="warning">
              Confirm the description of {proposal.pendingImages.map((n) => `"${n}"`).join(", ")} on the project page first – the council reads an image only
              through its confirmed description, so the requirements cannot be confirmed before.
            </Alert>
          ) : null}
          {proposal.unscannedDocuments.length ? (
            <Alert tone="warning">
              Not scanned for requirements (format): {proposal.unscannedDocuments.map((d) => d.name).join(", ")}. Add their hard requirements by hand.
            </Alert>
          ) : null}
          {proposal.notProposed > 0 ? (
            <Alert tone="warning">
              {proposal.notProposed} further statement(s) were not proposed because the list is full. Add the ones that are requirements by hand.
            </Alert>
          ) : null}

          {rows.length === 0 && canWrite ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={noHard} onChange={(e) => setNoHard(e.target.checked)} />
              This brief has no hard requirements.
            </label>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void confirm()} disabled={busy || toDecide.length > 0 || (rows.length === 0 && !noHard)}>
                {busy ? "Confirming…" : "Confirm requirements"}
              </Button>
              {proposal.current ? (
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">Only members who can edit the project can confirm the requirements.</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * #226: what the gate will do with the numbers of a requirement while it is still being edited – one limit is
 * estimated by the models; several limits in one sentence are not checked as numbers until the sentence is split.
 */
function MeasureHint({ text }: { text: string }) {
  const measure = detectMeasure(text);
  if (measure) return <Badge tone="accent">estimated by the models: {describeMeasure(measure)}</Badge>;
  if (countLimits(text) > 1) return <Badge tone="warning">several limits in one sentence – split it to check each as a number</Badge>;
  return null;
}

/**
 * #245: nobody can confirm an experience ("stable", "smooth") before it is built, so such a requirement blocks the
 * verdict. The requirement stays as written; the user may add a measurement plan as an extra requirement.
 */
function AfterImplementationHint({ text, planned, onAdd }: { text: string; planned: boolean; onAdd?: () => void }) {
  return (
    <div className="mb-2 rounded-md border border-line bg-surface p-2 text-xs text-muted" data-testid="after-implementation-hint">
      <Badge tone="warning">only measurable after implementation</Badge> Before anything is built, no model can confirm “
      {text.length > 80 ? `${text.slice(0, 80)}…` : text}”, so the council will end with “needs verification”. Keep it as it is, and add how it is measured
      (method, target value) so the proposals can be compared on it.
      {onAdd && !planned ? (
        <Button variant="ghost" className="ml-1 px-2 py-0.5 text-xs" onClick={onAdd}>
          Add a measurement plan as a requirement
        </Button>
      ) : null}
    </div>
  );
}
