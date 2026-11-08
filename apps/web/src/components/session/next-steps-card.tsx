"use client";

import { useTranslations } from "next-intl";
import { Card } from "../ui/surface";
import { proposalLabel, type View } from "./helpers";
import type { NextSteps } from "./next-steps";

/** "What next" checklist (#273): stored statements only, each section with its source; empty sections say so. */
export function NextStepsCard({ view, steps, mode }: { view: View; steps: NextSteps; mode: "chosen" | "recommended" | "tie" | "blocked" }) {
  const t = useTranslations("verdict.nextSteps");
  const req = useTranslations("verdict.dashboard.req");
  const sev = useTranslations("verdict.cruxes.severity");
  const label = proposalLabel(view, steps.proposalId);
  return (
    <Card>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-xs text-muted">
        {mode === "chosen" ? t("introChosen", { label }) : mode === "recommended" ? t("introRecommended", { label }) : mode === "tie" ? t("introTie", { label }) : t("introLeading", { label })}
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Section title={t("verify.title")} source={t("verify.source")} empty={t("verify.empty")}>
          {steps.verify.map((r) => (
            <li key={r.id}>
              <span className="font-medium">{r.id}</span> {r.text} <span className="text-warning">({req.has(r.status) ? req(r.status) : r.status})</span>
            </li>
          ))}
          {steps.objections.map((o, i) => (
            <li key={`o${i}`}>
              <span className="text-danger">{sev.has(o.severity) ? sev(o.severity) : o.severity}</span> · {o.claim}
              {o.by ? <span className="text-muted"> ({t("verify.raisedBy", { model: o.by })})</span> : null}
            </li>
          ))}
        </Section>
        {/* #273 stage 1: the strongest counter-position, from the same ranking as Key disputes (#267). */}
        <Section title={t("counter.title")} source={t("counter.source")} empty={t("counter.empty")}>
          {steps.counter ? (
            <li>
              <span className="font-medium">{steps.counter.claim}</span> <span className="text-muted">({t("verify.raisedBy", { model: steps.counter.by })})</span>
              <span className="block text-muted">{steps.counter.evidence ? t("counter.rightIf", { text: steps.counter.evidence }) : t("counter.noReason")}</span>
            </li>
          ) : null}
        </Section>
        {/* #273 stage 2: the author's own suggestion (model output, labelled as such), never a gate. */}
        <Section title={t("test.title")} source={t("test.source")} empty={t("test.empty")}>
          {steps.cheapestTest ? (
            <li>
              {steps.cheapestTest.assumption ? <span className="block">{t("test.assumption", { text: steps.cheapestTest.assumption })}</span> : null}
              {steps.cheapestTest.method ? <span className="block">{t("test.method", { text: steps.cheapestTest.method })}</span> : null}
              <span className="block text-muted">
                {steps.cheapestTest.successCriterion ? t("test.success", { text: steps.cheapestTest.successCriterion }) : t("test.noSuccess")}
              </span>
            </li>
          ) : null}
        </Section>
        <Section title={t("assumptions.title")} source={t("assumptions.source")} empty={t("assumptions.empty")}>
          {steps.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </Section>
        <Section title={t("stopIf.title")} source={t("stopIf.source")} empty={t("stopIf.empty")}>
          {steps.stopCriteria.map((s, i) => (
            <li key={`c${i}`}>
              {s} <span className="text-muted">({t("aiSuggestion")})</span>
            </li>
          ))}
          {steps.stopIf.map((s, i) => (
            <li key={i}>
              {s.risk}
              {s.mitigation ? <span className="block text-muted">{t("stopIf.mitigation", { text: s.mitigation })}</span> : null}
            </li>
          ))}
        </Section>
        {/* The open points themselves are listed under Key disputes – here only the trigger and a pointer, not the list again. */}
        <Section title={t("revisit.title")} source={t("revisit.source")} empty={t("revisit.empty")}>
          {steps.revisitTriggers.map((s, i) => (
            <li key={`r${i}`}>
              {s} <span className="text-muted">({t("aiSuggestion")})</span>
            </li>
          ))}
          {steps.revisitWhen.length ? <li>{t("revisit.pointer", { n: steps.revisitWhen.length })}</li> : null}
        </Section>
      </div>
      {mode === "blocked" ? <p className="mt-3 text-xs text-warning">{t("notYet")}</p> : null}
      <p className="mt-3 text-[11px] text-muted">{t("note")}</p>
    </Card>
  );
}

function Section({ title, source, empty, children }: { title: string; source: string; empty: string; children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <section className="rounded-xl border border-line p-3 text-xs">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-[11px] text-muted">{source}</p>
      {items.length ? <ul className="mt-2 list-disc space-y-1 pl-4">{children}</ul> : <p className="mt-2 text-muted">{empty}</p>}
    </section>
  );
}
