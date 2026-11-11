"use client";

import type { CouncilRole, ProfileSuggestion, RoleSuggestionResult } from "@consyrium/core/browser";
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
  skill,
  profileSuggestions = [],
  profileNames = {},
}: {
  suggestion: RoleSuggestionResult;
  /** #269 on top of #270: the role profile suggested with each role (set on apply only where none is chosen yet). */
  profileSuggestions?: readonly ProfileSuggestion[];
  profileNames?: Record<string, string>;
  active: readonly CouncilRole[];
  onApply: (roles: CouncilRole[]) => void;
  /**
   * A chosen skill (#421): its roles are the active selection, this project suggestion is only an alternative –
   * "replace" swaps the selection for the suggestion, "add" keeps the selection and adds the suggested roles it lacks.
   */
  skill?: { name: string; roles: readonly CouncilRole[] } | null;
}) {
  const t = useTranslations("roleSuggestion");
  const roles = suggestion.suggested.map((s) => s.role);
  const applied = roles.length === active.length && roles.every((r) => active.includes(r));
  const missing = roles.filter((r) => !active.includes(r));
  const alternative = Boolean(skill?.roles.length);
  return (
    <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3" data-testid="role-suggestion">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{alternative ? t("titleAlternative") : t("title")}</p>
          <p className="text-xs text-muted">{alternative ? t("introAlternative", { name: skill!.name, n: skill!.roles.length }) : t("intro")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={applied} onClick={() => onApply(roles)}>
            {applied ? t("applied") : alternative ? t("replace", { n: roles.length }) : t("apply", { n: roles.length })}
          </Button>
          {alternative && missing.length && !applied ? (
            <Button variant="ghost" onClick={() => onApply([...active, ...missing])}>
              {t("add", { n: missing.length })}
            </Button>
          ) : null}
        </div>
      </div>
      {applied ? null : (
        <p className="mt-2 text-xs text-muted" data-testid="role-suggestion-effect">
          {alternative
            ? t("effectAlternative", { n: roles.length, current: active.length, missing: missing.length })
            : t("effect", { n: roles.length, current: active.length })}
        </p>
      )}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {suggestion.suggested.map((s) => (
          <li key={s.role} className="rounded-lg border border-line bg-surface p-2.5 text-xs">
            <p className="font-medium text-text">{t(`names.${s.role}`)}</p>
            <p className="mt-0.5 text-muted">{t(`questions.${s.role}`)}</p>
            <ProfileLine suggestion={profileSuggestions.find((p) => p.role === s.role)} names={profileNames} />
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

function ProfileLine({ suggestion, names }: { suggestion: ProfileSuggestion | undefined; names: Record<string, string> }) {
  const t = useTranslations("roleSuggestion");
  if (!suggestion) return null;
  const name = suggestion.profileId ? names[suggestion.profileId] : undefined;
  if (name)
    return (
      <p className="mt-1 text-[11px] text-primary" data-testid="suggested-profile">
        {t("profile.suggested", { name })}
      </p>
    );
  if (suggestion.workspaceProfiles > 1) return <p className="mt-1 text-[11px] text-muted">{t("profile.choose", { n: suggestion.workspaceProfiles })}</p>;
  return null;
}
