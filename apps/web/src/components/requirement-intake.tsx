"use client";

import {
  countLimits,
  describeMeasure,
  detectMeasure,
  measurableOnlyAfterImplementation,
  measurementPlanSuggestion,
  type RequirementMeasure,
} from "@consyrion/core/browser";
import { useTranslations } from "next-intl";
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

interface Row {
  uid: string;
  text: string;
  candidateKey: string | null;
  source: IntakeSource;
  isNew: boolean;
  sourceGone: boolean;
}

type Translate = ReturnType<typeof useTranslations>;

function sourceLabel(t: Translate, source: IntakeSource) {
  return source.kind === "document" && source.documentName ? t("source.documentNamed", { name: source.documentName }) : t(`source.${source.kind}`);
}

let counter = 0;
const uid = () => `row-${++counter}`;

export function RequirementIntake({ projectId, proposal, canWrite }: { projectId: string; proposal: IntakeProposal; canWrite: boolean }) {
  const t = useTranslations("requirements");
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
      setError(err instanceof ApiRequestError ? err.message : t("confirmError"));
    } finally {
      setBusy(false);
    }
  }

  const latest = proposal.latest;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("intro")}</p>
        </div>
        {proposal.current && latest ? (
          <Badge tone="success">{t("versionConfirmed", { version: latest.version })}</Badge>
        ) : (
          <Badge tone="warning">{latest ? t("needsAgain") : t("notConfirmed")}</Badge>
        )}
      </div>

      {!proposal.current && latest ? (
        <div className="mt-3">
          <Alert tone="warning">
            {t("changed", { version: latest.version, briefVersion: latest.briefVersion })}
          </Alert>
        </div>
      ) : null}

      {!editing && latest ? (
        <div className="mt-4 space-y-3 text-sm">
          {latest.items.length === 0 ? (
            <p className="text-muted">{t("confirmedNone")}</p>
          ) : (
            <ol className="space-y-1">
              {latest.items.map((item) => (
                <li key={item.id} className="flex gap-2">
                  <span className="font-mono text-xs text-muted">{item.id}</span>
                  <span>
                    {item.text}
                    {item.measure ? (
                      <span className="ml-2 inline-block">
                        <Badge tone="accent">{t("estimated", { measure: describeMeasure(item.measure) })}</Badge>
                      </span>
                    ) : countLimits(item.text) > 1 ? (
                      <span className="ml-2 inline-block">
                        <Badge tone="warning">{t("severalLimits")}</Badge>
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {latest.excluded.length ? (
            <details>
              <summary className="cursor-pointer text-muted">{t("excludedSummary", { n: latest.excluded.length })}</summary>
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
              {t("edit")}
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
                  <span>{sourceLabel(t, row.source)}</span>
                  {row.isNew ? <Badge tone="primary">{t("new")}</Badge> : null}
                  {row.sourceGone ? <Badge tone="warning">{t("sourceGone")}</Badge> : null}
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
                    aria-label={t("rowLabel", { n: index + 1 })}
                    value={row.text}
                    disabled={!canWrite}
                    onChange={(e) => update(row.uid, e.target.value)}
                    className={`${control} min-h-12`}
                  />
                  {canWrite ? (
                    <Button variant="ghost" className="px-2" onClick={() => remove(row)} aria-label={t("removeLabel", { n: index + 1 })}>
                      {t("remove")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {canWrite ? (
            <Button variant="secondary" onClick={() => addRequirement("")}>
              {t("add")}
            </Button>
          ) : null}

          {toDecide.length ? (
            <div role="region" aria-label={t("toDecideLabel")}>
              <h3 className="text-sm font-medium">{t("toDecide", { n: toDecide.length })}</h3>
              <p className="mt-1 text-xs text-muted">
                {t("toDecideText")}
              </p>
              <ul className="mt-2 space-y-2">
                {toDecide.map((entry) => (
                  <li key={entry.candidateKey} className="rounded-lg border border-warning/50 p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{sourceLabel(t, entry.source)}</span>
                      <Badge tone="warning">{t("pleaseCheck")}</Badge>
                    </div>
                    <p>{entry.text}</p>
                    <p className="mt-1 text-xs text-muted">{t(`suspicion.${entry.suspicion}`)}</p>
                    {canWrite ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => decide(entry.candidateKey, true)}>
                          {t("keep")}
                        </Button>
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => decide(entry.candidateKey, false)}>
                          {t("notRequirement")}
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
              <h3 className="text-sm font-medium">{t("excludedTitle")}</h3>
              <p className="mt-1 text-xs text-muted">
                {t("excludedText")}
              </p>
              <ul className="mt-2 space-y-2">
                {excluded.map((entry) => (
                  <li key={entry.candidateKey} className="rounded-lg border border-line p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted">{sourceLabel(t, entry.source)}</span>
                      {canWrite ? (
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => keep(entry.candidateKey)}>
                          {t("keep")}
                        </Button>
                      ) : null}
                    </div>
                    <p className="line-through">{entry.text}</p>
                    <input
                      aria-label={t("reasonLabel")}
                      placeholder={t("reason")}
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
              {t("pendingImages", { names: proposal.pendingImages.map((n) => `"${n}"`).join(", ") })}
            </Alert>
          ) : null}
          {proposal.unscannedDocuments.length ? (
            <Alert tone="warning">
              {t("unscanned", { names: proposal.unscannedDocuments.map((d) => d.name).join(", ") })}
            </Alert>
          ) : null}
          {proposal.notProposed > 0 ? (
            <Alert tone="warning">
              {t("notProposed", { n: proposal.notProposed })}
            </Alert>
          ) : null}

          {rows.length === 0 && canWrite ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={noHard} onChange={(e) => setNoHard(e.target.checked)} />
              {t("noHard")}
            </label>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void confirm()} disabled={busy || toDecide.length > 0 || (rows.length === 0 && !noHard)}>
                {busy ? t("confirming") : t("confirm")}
              </Button>
              {proposal.current ? (
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  {t("cancel")}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">{t("readOnly")}</p>
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
  const t = useTranslations("requirements");
  const measure = detectMeasure(text);
  if (measure) return <Badge tone="accent">{t("estimated", { measure: describeMeasure(measure) })}</Badge>;
  if (countLimits(text) > 1) return <Badge tone="warning">{t("splitLimits")}</Badge>;
  return null;
}

/**
 * #245: nobody can confirm an experience ("stable", "smooth") before it is built, so such a requirement blocks the
 * verdict. The requirement stays as written; the user may add a measurement plan as an extra requirement.
 */
function AfterImplementationHint({ text, planned, onAdd }: { text: string; planned: boolean; onAdd?: () => void }) {
  const t = useTranslations("requirements");
  return (
    <div className="mb-2 rounded-md border border-line bg-surface p-2 text-xs text-muted" data-testid="after-implementation-hint">
      <Badge tone="warning">{t("afterImplementation")}</Badge> {t("afterImplementationText", { text: text.length > 80 ? `${text.slice(0, 80)}…` : text })}
      {onAdd && !planned ? (
        <Button variant="ghost" className="ml-1 px-2 py-0.5 text-xs" onClick={onAdd}>
          {t("addPlan")}
        </Button>
      ) : null}
    </div>
  );
}
