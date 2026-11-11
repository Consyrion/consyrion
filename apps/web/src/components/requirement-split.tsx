"use client";

import { splitPartLetter, type RequirementDecomposition } from "@consyrium/core/browser";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";

/**
 * Split suggestion for one requirement in the intake (#216). The server proposes parts deterministically; nothing is
 * split until the user clicks, and "keep as one" leaves the original exactly as it is. Coupled or unclear statements
 * get a note instead of a proposal – the user may still split them by hand.
 */
export function SplitSuggestion({
  decomposition,
  canWrite,
  wouldExceed,
  onSplit,
  onManualSplit,
  onKeep,
}: {
  decomposition: RequirementDecomposition;
  canWrite: boolean;
  /** Splitting would take the list over the per-list limit: never cut silently, the button explains instead. */
  wouldExceed: boolean;
  onSplit: (parts: string[]) => void;
  onManualSplit: () => void;
  onKeep: () => void;
}) {
  const t = useTranslations("requirements.split");
  if (decomposition.kind === "coupled") return <p className="mb-2 text-xs text-muted">{t("coupled")}</p>;
  if (decomposition.kind === "unclear")
    return (
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{t(`unclear.${decomposition.reason}`)}</span>
        {canWrite ? (
          <Button variant="ghost" className="px-2 py-1 text-xs" disabled={wouldExceed} onClick={onManualSplit}>
            {t("manual")}
          </Button>
        ) : null}
      </div>
    );
  return (
    <div className="mb-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5 text-xs" data-testid="split-suggestion">
      <p className="font-medium text-text">{t("proposal", { n: decomposition.parts.length })}</p>
      <ol className="mt-1 space-y-0.5">
        {decomposition.parts.map((part, i) => (
          <li key={i} className="flex gap-2">
            <span className="font-mono text-muted">{splitPartLetter(i + 1)}</span>
            <span>{part}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-muted">{t("proposalNote")}</p>
      {canWrite ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={wouldExceed} onClick={() => onSplit(decomposition.parts)}>
            {t("apply", { n: decomposition.parts.length })}
          </Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onKeep}>
            {t("keep")}
          </Button>
        </div>
      ) : null}
      {wouldExceed ? <p className="mt-1 text-warning">{t("limit")}</p> : null}
    </div>
  );
}

/** "Part b of 3 – from: …" under a split part (editing and confirmed view). */
export function SplitOrigin({ original, part, of }: { original: string; part: number; of: number }) {
  const t = useTranslations("requirements.split");
  return (
    <p className="mt-0.5 text-xs text-muted" data-testid="split-origin">
      {t("origin", { part: splitPartLetter(part), of, original: original.length > 120 ? `${original.slice(0, 117)}…` : original })}
    </p>
  );
}
