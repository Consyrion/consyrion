import { can } from "@consyrium/core";
import { listInvitations, listMembers } from "@consyrium/db";
import { getTranslations } from "next-intl/server";
import { TeamManager } from "@/components/saas";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  const t = await getTranslations("settings.pages");
  return { title: t("team.title") };
}

export default async function TeamPage() {
  const actor = await requirePageActor();
  const db = await getDb();
  const t = await getTranslations("settings.pages.team");
  const canManage = can(actor.role, "member:manage");
  const [members, invitations] = await Promise.all([listMembers(db, actor), canManage ? listInvitations(db, actor) : Promise.resolve([])]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <TeamManager
        members={members.map((m) => ({ ...m }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
        canManage={canManage}
        currentUserId={actor.userId}
      />
    </>
  );
}
