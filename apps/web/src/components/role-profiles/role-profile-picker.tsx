"use client";

import type { CouncilRole } from "@consyrium/core/browser";
import { useTranslations } from "next-intl";
import { SelectField } from "../ui/field";
import type { RoleProfileRow } from "./role-profile-manager";

/**
 * Council setup (#270): one optional role profile per active role. A profile only sharpens that role's prompt – the
 * note says so next to the choice. Roles without a profile in the workspace show nothing.
 */
export function RoleProfilePicker({
  roles,
  profiles,
  value,
  onChange,
  roleLabel,
}: {
  roles: readonly CouncilRole[];
  profiles: readonly RoleProfileRow[];
  value: Partial<Record<CouncilRole, string>>;
  onChange: (next: Partial<Record<CouncilRole, string>>) => void;
  roleLabel: (role: CouncilRole) => string;
}) {
  const t = useTranslations("roleProfiles");
  const withProfiles = roles.filter((role) => profiles.some((p) => p.role === role));
  if (withProfiles.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-[#a78bfa]/40 bg-surface-2 px-3 py-3" data-testid="role-profile-picker">
      <p className="text-sm font-medium">{t("pickerTitle")}</p>
      <p className="text-xs text-muted">{t("pickerNote")}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {withProfiles.map((role) => (
          <SelectField
            key={role}
            label={roleLabel(role)}
            value={value[role] ?? ""}
            onChange={(e) => onChange({ ...value, [role]: e.target.value || undefined })}
          >
            <option value="">{t("pickerNone")}</option>
            {profiles
              .filter((p) => p.role === role)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {t(`visibility.${p.visibility}`)} · {t("versionShort", { version: p.version })}
                  {p.forkedFromName ? ` · ${t("adoptedFrom", { name: p.forkedFromName })}` : ""}
                </option>
              ))}
          </SelectField>
        ))}
      </div>
    </div>
  );
}

/** The ids sent with the session: only profiles of roles that are still active. */
export function chosenRoleProfileIds(roles: readonly CouncilRole[], value: Partial<Record<CouncilRole, string>>): string[] {
  return roles.map((role) => value[role]).filter((id): id is string => Boolean(id));
}
