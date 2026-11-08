"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "../ui/button";
import { SelectField, TextAreaField, TextField } from "../ui/field";
import { Alert, Badge, Card } from "../ui/surface";
import { proposalLabel, type View } from "./helpers";
import type { RequirementGateResult } from "./requirement-gate";
import { measurementRows } from "./measurements";

/**
 * #249 gate 2 – acceptance by measurement (owner decision 08.11.26). Per architecture candidate: the requirements whose
 * measurement is open, every recorded result (always named as a self-declaration with its evidence) and, for a person
 * with the approval role, a form to record one. Display only – the server decides what counts.
 */
export function MeasurementPanel({
  view,
  gate,
  canRecord,
  onChange,
}: {
  view: View;
  gate: RequirementGateResult;
  canRecord: boolean;
  onChange: () => Promise<void> | void;
}) {
  const t = useTranslations("measurement");
  const format = useFormatter();
  const rows = measurementRows(view, gate);
  if (!rows.length) return null;
  return (
    <Card>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted">{t("intro")}</p>
      <div className="mt-3 space-y-4">
        {rows.map((p) => (
          <section key={p.proposalId} className="rounded-xl border border-line p-3" data-testid="measurement-candidate">
            <p className="font-medium">{t("proposal", { label: proposalLabel(view, p.proposalId) })}</p>
            <ul className="mt-2 space-y-3 text-sm">
              {p.requirements.map((r) => {
                const { own, state } = r;
                return (
                  <li key={r.requirementId}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={state === "met" ? "success" : state === "notMet" ? "danger" : "warning"}>{t(state)}</Badge>
                      <span>
                        <strong>{r.requirementId}</strong> {r.text}
                      </span>
                    </div>
                    {own.length ? (
                      <ul className="mt-1 space-y-1 pl-4 text-xs text-muted">
                        {own.map((m) => (
                          <li key={m.id} data-testid="measurement-result">
                            {t("selfDeclared", { person: m.recordedBy, evidence: m.evidence })} ·{" "}
                            {t("values", { method: m.method, target: m.target, measured: m.measured })} ·{" "}
                            {format.dateTime(new Date(m.createdAt), { dateStyle: "short", timeStyle: "short" })}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {canRecord && state !== "notMet" ? (
                      <RecordForm sessionId={view.session.id} proposalId={p.proposalId} requirementId={r.requirementId} onChange={onChange} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}

function RecordForm({
  sessionId,
  proposalId,
  requirementId,
  onChange,
}: {
  sessionId: string;
  proposalId: string;
  requirementId: string;
  onChange: () => Promise<void> | void;
}) {
  const t = useTranslations("measurement");
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("");
  const [target, setTarget] = useState("");
  const [measured, setMeasured] = useState("");
  const [met, setMet] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <Button variant="ghost" className="mt-1" onClick={() => setOpen(true)}>
        {t("record")}
      </Button>
    );
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/sessions/${sessionId}/measurements`, {
        method: "POST",
        body: JSON.stringify({ proposalId, requirementId, method, target, measured, met: met === "yes", evidence }),
      });
      setOpen(false);
      await onChange();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 grid gap-3 rounded-lg border border-line p-3 md:grid-cols-2">
      <TextField label={t("method")} value={method} onChange={(e) => setMethod(e.target.value)} maxLength={1000} />
      <TextField label={t("target")} value={target} onChange={(e) => setTarget(e.target.value)} maxLength={500} />
      <TextField label={t("measured")} value={measured} onChange={(e) => setMeasured(e.target.value)} maxLength={500} />
      <SelectField label={t("result")} value={met} onChange={(e) => setMet(e.target.value)}>
        <option value="">{t("choose")}</option>
        <option value="yes">{t("met")}</option>
        <option value="no">{t("notMet")}</option>
      </SelectField>
      <div className="md:col-span-2">
        <TextAreaField label={t("evidence")} hint={t("evidenceHint")} value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={2000} />
      </div>
      {error ? (
        <div className="md:col-span-2">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <div className="flex gap-2 md:col-span-2">
        <Button disabled={busy || !method.trim() || !target.trim() || !measured.trim() || !met || evidence.trim().length < 3} onClick={() => void save()}>
          {busy ? t("saving") : t("save")}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
