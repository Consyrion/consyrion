"use client";

import { useTranslations } from "next-intl";
import { Card } from "../ui/surface";
import type { View } from "./helpers";
import { processQualityLines } from "./process-quality-lines";

/**
 * #182 – process quality of this council from stored data only: participation (per model and per independent model),
 * convergence of the proposals, what became of the objections and whether the vote weights decided the winner. Every
 * line says what it measures; none of it proves that the verdict is right.
 */
export function ProcessQualityCard({ view }: { view: View }) {
  const t = useTranslations("processQuality");
  // The wording is shared with the PDF (#268): processQualityLines.
  const lines = processQualityLines(view, t as unknown as Parameters<typeof processQualityLines>[1]);
  if (!lines) return null;
  return (
    <Card>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted">{t("intro")}</p>
      <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2" data-testid="process-quality">
        {lines.map((line) => (
          <div key={line.key}>
            <dt className="font-medium">{line.title}</dt>
            <dd className="text-muted">{line.text}</dd>
            {line.limit ? <dd className="text-xs text-muted">{line.limit}</dd> : null}
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">{t("footer")}</p>
    </Card>
  );
}
