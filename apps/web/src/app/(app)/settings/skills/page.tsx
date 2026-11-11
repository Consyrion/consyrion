import { can, isUnlimited } from "@consyrium/core";
import { getEntitlements, listSkills } from "@consyrium/db";
import { getTranslations } from "next-intl/server";
import { SkillManager } from "@/components/skills/skill-manager";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import { skillHubPublishEnabled } from "@/lib/server/skillhub-flag";

export async function generateMetadata() {
  const t = await getTranslations("skills");
  return { title: t("title") };
}

/** Settings → Skills (#363): official, own and team skills; editor with preview, sharing, export and import. */
export default async function SkillsPage() {
  const actor = await requirePageActor();
  const t = await getTranslations("skills");
  const db = await getDb();
  const [skills, { entitlements }] = await Promise.all([listSkills(db, actor), getEntitlements(db, actor.organizationId)]);
  const own = skills.filter((s) => s.visibility !== "official" && s.ownerUserId === actor.userId).length;
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <SkillManager
        skills={skills.map((s) => ({ ...s, updatedAt: s.updatedAt?.toISOString() ?? null }))}
        canWrite={can(actor.role, "project:write")}
        publishEnabled={skillHubPublishEnabled()}
        limits={{ max: isUnlimited(entitlements.maxSkills) ? null : entitlements.maxSkills, own, team: entitlements.teamSkills }}
      />
    </>
  );
}
