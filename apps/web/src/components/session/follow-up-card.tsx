"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "../ui/button";
import { TextField } from "../ui/field";
import { Alert } from "../ui/surface";

type Kind = "completion" | "targeted_review";
interface Preview {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  completion: { items: number; estimatedTokens: number };
  targetedReview: { items: number; estimatedTokens: number };
}

/**
 * #228/#229 follow-up round as a next step of the verdict card: complete the checks an evaluator left out, or let the
 * same evaluators look again at their own UNKNOWN checks. Never automatic – the owner sees the estimate, sets an extra
 * budget and confirms it; the server checks everything again.
 */
export function FollowUpCard({ sessionId, onStarted }: { sessionId: string; onStarted: () => Promise<void> }) {
  const t = useTranslations("verdictScreen.followUp");
  const format = useFormatter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState<Kind | null>(null);
  const [budget, setBudget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<Preview>(`/api/sessions/${sessionId}/follow-up`)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [sessionId]);

  if (!preview || !preview.enabled || !preview.available) return null;
  const options: Array<{ kind: Kind; items: number; estimate: number }> = [
    { kind: "completion" as const, items: preview.completion.items, estimate: preview.completion.estimatedTokens },
    { kind: "targeted_review" as const, items: preview.targetedReview.items, estimate: preview.targetedReview.estimatedTokens },
  ].filter((o) => o.items > 0);
  const chosen = options.find((o) => o.kind === open) ?? null;

  async function start() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/sessions/${sessionId}/follow-up`, {
        method: "POST",
        body: JSON.stringify({ kind: chosen.kind, tokenBudget: Number(budget), confirmBudget: confirmed }),
      });
      await onStarted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-primary/30 p-3" data-testid="follow-up-card">
      <p className="font-medium">{t("title")}</p>
      <p className="text-xs text-muted">{t("intro")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={o.kind}
            variant={open === o.kind ? "primary" : "secondary"}
            onClick={() => {
              setOpen(o.kind);
              setBudget(String(Math.ceil((o.estimate * 1.2) / 1000) * 1000));
              setConfirmed(false);
            }}
          >
            {t(`${o.kind}.button`, { n: o.items, tokens: format.number(o.estimate) })}
          </Button>
        ))}
      </div>
      {chosen ? (
        <div className="mt-3 space-y-2 text-sm">
          <p>{t(`${chosen.kind}.explain`)}</p>
          <TextField
            label={t("budget")}
            hint={t("budgetHint", { tokens: format.number(chosen.estimate) })}
            type="number"
            min={chosen.estimate}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{t("confirm")}</span>
          </label>
          {error ? <Alert>{error}</Alert> : null}
          <Button disabled={busy || !confirmed || !(Number(budget) >= chosen.estimate)} onClick={() => void start()}>
            {busy ? t("starting") : t("start")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
