"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "../ui/button";
import { Markdown } from "../ui/markdown";
import { Badge } from "../ui/surface";
import type { View } from "./helpers";

/**
 * #15/#41 stage 1 – a human's questions after the verdict. Answers are an appendix: they never change proposals, scores,
 * votes, checks or the verdict, and the screen says so on every block. Asking costs tokens on the workspace's own keys:
 * first a preview (who answers, estimated tokens), then the user confirms the costs.
 */

type Intervention = NonNullable<View["interventions"]>[number];
type Kind = "question" | "statement_request";

/** States in which a verdict exists – the same rule as the server. */
const AFTER_VERDICT = new Set(["awaiting_approval", "approved", "rejected", "changes_requested"]);

export function canIntervene(view: View, canApprove: boolean) {
  return canApprove && AFTER_VERDICT.has(view.session.status) && (view.project as { status?: string }).status !== "archived";
}

function modelName(view: View, participantId: string | null) {
  return view.participants.find((p) => p.id === participantId)?.modelId ?? "?";
}

/** The answers of one intervention, clearly marked as a human's question without effect on the verdict. */
export function InterventionAnswers({ view, intervention }: { view: View; intervention: Intervention }) {
  const t = useTranslations("interventions");
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2.5 text-xs" data-testid="human-question">
      <p className="font-medium text-primary">
        {t("humanQuestion")} <span className="font-normal text-muted">– {t("noEffect")}</span>
      </p>
      {intervention.text ? <p className="italic">„{intervention.text}“</p> : null}
      {intervention.answers.map((a) => (
        <div key={a.id}>
          <p className="text-muted">{a.modelId || modelName(view, a.participantId)}:</p>
          {/* Models answer in Markdown (live check 10.11.26: "**bold**" showed raw) – same small subset as the assistant. */}
          {a.error ? <p className="text-warning">{t("noAnswer", { reason: a.error })}</p> : <Markdown text={a.body} />}
        </div>
      ))}
    </div>
  );
}

/** Asking with preview and cost confirmation; shows the new answers right away. */
function AskForm({ view, kind, targetId, onDone }: { view: View; kind: Kind; targetId?: string; onDone: (i: Intervention) => void }) {
  const t = useTranslations("interventions");
  const format = useFormatter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ models: Array<{ modelId: string; role: string }>; tokens: number; withinCap: boolean } | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/sessions/${view.session.id}/interventions`;
  const body = { kind, targetId, text: text.trim() };

  async function check() {
    setError(null);
    setBusy(true);
    try {
      setPreview(await fetchJson(base, { method: "POST", body: JSON.stringify({ ...body, preview: true }) }));
      setConsent(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJson<{ intervention: Omit<Intervention, "answers">; answers: Intervention["answers"] }>(base, {
        method: "POST",
        body: JSON.stringify({ ...body, confirmCosts: true }),
      });
      onDone({ ...r.intervention, answers: r.answers } as Intervention);
      setText("");
      setPreview(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-1.5 text-xs">
      <textarea
        value={text}
        maxLength={1000}
        rows={2}
        placeholder={kind === "question" ? t("questionPlaceholder") : t("statementPlaceholder")}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-text focus:border-primary focus:outline-none"
      />
      {preview ? (
        <>
          <p className="text-muted">{t("preview", { models: preview.models.map((m) => m.modelId).join(", "), tokens: format.number(preview.tokens) })}</p>
          {!preview.withinCap ? <p className="text-warning">{t("overCap")}</p> : null}
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consent} disabled={!preview.withinCap} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>{t("consent", { tokens: format.number(preview.tokens) })}</span>
          </label>
          <Button variant="primary" disabled={busy || !consent || (kind === "question" && text.trim().length < 3)} onClick={() => void send()}>
            {busy ? t("asking") : t("send")}
          </Button>
        </>
      ) : (
        <Button variant="ghost" disabled={busy || (kind === "question" && text.trim().length < 3)} onClick={() => void check()}>
          {t("checkCosts")}
        </Button>
      )}
      {error ? <p className="text-danger">{error}</p> : null}
    </div>
  );
}

/** Under one objection: its human questions with answers, a mark "important" and "request a statement". */
export function ObjectionInterventions({ view, objectionId, canApprove }: { view: View; objectionId: string; canApprove: boolean }) {
  const t = useTranslations("interventions");
  const [added, setAdded] = useState<Intervention[]>([]);
  const [open, setOpen] = useState(false);
  const all = [...(view.interventions ?? []), ...added].filter((i) => i.targetType === "objection" && i.targetId === objectionId);
  const [marked, setMarked] = useState(all.some((i) => i.kind === "mark"));
  const statements = all.filter((i) => i.kind === "statement_request");
  const allowed = canIntervene(view, canApprove);

  async function toggleMark() {
    try {
      const r = await fetchJson<{ marked: boolean }>(`/api/sessions/${view.session.id}/interventions/mark`, {
        method: "POST",
        body: JSON.stringify({ targetType: "objection", targetId: objectionId }),
      });
      setMarked(r.marked);
    } catch {
      /* the server explains on the next try */
    }
  }

  if (!allowed && !statements.length && !marked) return null;
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {marked ? <Badge tone="warning">{t("markedImportant")}</Badge> : null}
        {allowed ? (
          <>
            <button type="button" className="underline hover:text-text" onClick={() => void toggleMark()}>
              {marked ? t("unmark") : t("mark")}
            </button>
            <button type="button" className="underline hover:text-text" onClick={() => setOpen((v) => !v)}>
              {t("requestStatement")}
            </button>
          </>
        ) : null}
      </div>
      {statements.map((i) => (
        <InterventionAnswers key={i.id} view={view} intervention={i} />
      ))}
      {open && allowed ? (
        <AskForm
          view={view}
          kind="statement_request"
          targetId={objectionId}
          onDone={(i) => {
            setAdded((a) => [...a, i]);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** On the verdict screen: ask the council a question; every model answers about its own proposal. */
export function CouncilQuestions({ view, canApprove }: { view: View; canApprove: boolean }) {
  const t = useTranslations("interventions");
  const [added, setAdded] = useState<Intervention[]>([]);
  const questions = [...(view.interventions ?? []), ...added].filter((i) => i.kind === "question");
  const allowed = canIntervene(view, canApprove);
  if (!allowed && !questions.length) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-line bg-surface p-4" id="human-questions" data-testid="council-questions">
      <h3 className="font-semibold">{t("councilTitle")}</h3>
      <p className="text-xs text-muted">{t("councilNote")}</p>
      {questions.map((i) => (
        <InterventionAnswers key={i.id} view={view} intervention={i} />
      ))}
      {allowed ? <AskForm view={view} kind="question" onDone={(i) => setAdded((a) => [...a, i])} /> : null}
    </section>
  );
}

/** For the key disputes card (#267, read-only): how many human questions and marks exist – never part of the ranking. */
export function interventionCounts(view: View) {
  const all = view.interventions ?? [];
  return { questions: all.filter((i) => i.kind !== "mark").length, marks: all.filter((i) => i.kind === "mark").length };
}
