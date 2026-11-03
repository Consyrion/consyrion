import { can } from "@consyrion/core";
import { listInvitations, listMembers } from "@consyrion/db";
import { TeamManager } from "@/components/saas";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const actor = await requirePageActor();
  const db = await getDb();
  const canManage = can(actor.role, "member:manage");
  const [members, invitations] = await Promise.all([listMembers(db, actor), canManage ? listInvitations(db, actor) : Promise.resolve([])]);
  return (
    <>
      <PageHeader title="Team" description="Members of this workspace and their roles. Owners and admins can invite people; only owners can grant the owner role." />
      <TeamManager
        members={members.map((m) => ({ ...m }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
        canManage={canManage}
        currentUserId={actor.userId}
      />
    </>
  );
}
