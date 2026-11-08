"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "../ui/select";

/** "Skill verwenden" on the council setup (#363): the choice lives in the URL (?skill=…) so the server pre-fills the page. */
export function SkillPicker({ options, value }: { options: Array<{ id: string; name: string; group: "official" | "own" | "team" }>; value: string | null }) {
  const t = useTranslations("skills.picker");
  const router = useRouter();
  const pathname = usePathname();
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium">{t("label")}</span>
      <Select
        aria-label={t("label")}
        size="sm"
        value={value ?? ""}
        onChange={(e) => router.replace(e.target.value ? `${pathname}?skill=${encodeURIComponent(e.target.value)}` : pathname, { scroll: false })}
      >
        <option value="">{t("none")}</option>
        {(["own", "team", "official"] as const).map((group) =>
          options.some((o) => o.group === group) ? (
            <optgroup key={group} label={t(`group.${group}`)}>
              {options
                .filter((o) => o.group === group)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </optgroup>
          ) : null,
        )}
      </Select>
    </div>
  );
}
