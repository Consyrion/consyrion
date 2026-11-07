"use client";

import type { CouncilRole, RoleSuggestionResult } from "@consyrion/core/browser";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";

/**
 * Suggested perspectives for this project (#269): deterministic from the brief and the confirmed requirements, with
 * the core question each role asks and the words or requirements that led to it. Applying is the user's click –
 * nothing changes on its own, and the roles stay perspectives, not extra votes.
 */
export function RoleSuggestionCard({
  suggestion,
  active,
  onApply,
}: {
  suggestion: RoleSuggestionResult;
  active: readonly CouncilRole[];
  onApply: (roles: CouncilRole[]) => void;
}) {
  const t = useTranslations("roleSuggestion");
  const roles = suggestion.suggested.map((s) => s.role);
  const applied = roles.length === active.length && roles.every((r) => active.includes(r));
  return (
    <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3" data-testid="role-suggestion">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-xs text-muted">{t("intro")}</p>
        </div>
        <Button variant="secondary" disabled={applied} onClick={() => onApply(roles)}>
          {applied ? t("applied") : t("apply", { n: roles.length })}
        </Button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {suggestion.suggested.map((s) => (
          <li key={s.role} className="rounded-lg border border-line bg-surface p-2.5 text-xs">
            <p className="font-medium text-text">{t(`names.${s.role}`)}</p>
            <p className="mt-0.5 text-muted">{t(`questions.${s.role}`)}</p>
            <p className="mt-1 text-[11px] text-muted">
              {s.always
                ? t(s.role === "security_expert" ? "always.security" : "always.critic")
                : [
                    s.matched.length ? t("because.words", { words: s.matched.slice(0, 4).join(", ") }) : null,
                    s.requirements.length ? t("because.requirements", { ids: s.requirements.join(", ") }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || t("because.default")}
            </p>
          </li>
        ))}
      </ul>
      {suggestion.notSuggested.length ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">{t("notSuggested", { n: suggestion.notSuggested.length })}</summary>
          <p className="mt-1 text-muted">
            {suggestion.notSuggested.map((r) => t(`names.${r.role}`)).join(", ")} – {t("notSuggestedWhy")}
          </p>
        </details>
      ) : null}
      <p className="mt-2 text-[11px] text-muted">{t("note")}</p>
    </div>
  );
}
