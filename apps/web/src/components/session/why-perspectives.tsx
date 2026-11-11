"use client";

import type { CouncilRole, RoleOrigin } from "@consyrium/core/browser";
import { useTranslations } from "next-intl";
import { Badge } from "../ui/surface";
import { useRoleLabel, type View } from "./helpers";

const ORIGIN_TONE: Record<RoleOrigin, "accent" | "primary" | "neutral"> = { suggestion: "primary", skill: "accent", own: "neutral", coverage: "neutral", default: "neutral" };

/**
 * "Why these perspectives" (#269): read only from the role selection frozen at the start (`session.roleSelection`) –
 * where each active role came from, the words and requirements behind a suggested one, the frozen profile, and what was
 * not suggested. Older councils without the snapshot show nothing rather than a reconstruction.
 */
export function WhyPerspectives({ view }: { view: View }) {
  const t = useTranslations("phaseScreens.why");
  const roleLabel = useRoleLabel();
  const selection = view.session.roleSelection;
  if (!selection) return null;
  const profileName = (id: string | null) => (id ? (view.session.roleProfiles ?? []).find((p) => p.profileId === id)?.content.name : undefined);
  const reason = (role: CouncilRole) => {
    const s = selection.suggested.find((x) => x.role === role);
    if (!s) return null;
    if (s.always) return t(role === "security_expert" ? "always.security" : "always.critic");
    return (
      [
        s.matched.length ? t("words", { words: s.matched.slice(0, 4).join(", ") }) : null,
        s.requirements.length ? t("requirements", { ids: s.requirements.join(", ") }) : null,
      ]
        .filter(Boolean)
        .join(" · ") || t("default")
    );
  };
  return (
    <details className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm" data-testid="why-perspectives">
      <summary className="cursor-pointer font-medium">{t("title")}</summary>
      <p className="mt-1 text-xs text-muted">{t("counts", { models: selection.models, perspectives: selection.roles.length })}</p>
      <ul className="mt-2 space-y-2">
        {selection.roles.map((r) => {
          const why = reason(r.role);
          const profile = profileName(r.profileId);
          return (
            <li key={r.role} className="text-xs">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text">{roleLabel(r.role)}</span>
                <Badge tone={ORIGIN_TONE[r.origin]}>{t(`origin.${r.origin}`)}</Badge>
              </span>
              {why ? <span className="mt-0.5 block text-muted">{why}</span> : null}
              {profile ? <span className="mt-0.5 block text-muted">{t("profile", { name: profile })}</span> : null}
            </li>
          );
        })}
      </ul>
      {selection.notSuggested.length ? (
        <p className="mt-2 text-xs text-muted">{t("notSuggested", { roles: selection.notSuggested.map((r) => roleLabel(r)).join(", ") })}</p>
      ) : null}
      <p className="mt-2 text-[11px] text-muted">{t("note")}</p>
    </details>
  );
}
