import { can } from "@consyrion/core";
import { listRoleProfiles } from "@consyrion/db";
import { getTranslations } from "next-intl/server";
import { RoleProfileManager } from "@/components/role-profiles/role-profile-manager";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  const t = await getTranslations("roleProfiles");
  return { title: t("title") };
}

/** Settings → Role profiles (#270): curated, own and team profiles for the 12 Minds roles. */
export default async function RoleProfilesPage() {
  const actor = await requirePageActor();
  const t = await getTranslations("roleProfiles");
  const profiles = await listRoleProfiles(await getDb(), actor);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <RoleProfileManager
        profiles={profiles.map((p) => ({ ...p, updatedAt: p.updatedAt?.toISOString() ?? null }))}
        canWrite={can(actor.role, "project:write")}
        canShare={can(actor.role, "member:manage")}
      />
    </>
  );
}
