import { listOrganizationsForUser } from "@consyrion/db";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSessionUser, requirePageActor } from "@/lib/server/actor";
import { isPlatformAdmin } from "@/lib/server/admin";
import { getDb } from "@/lib/server/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const actor = await requirePageActor();
  const orgs = await listOrganizationsForUser(await getDb(), user.id);
  const org = orgs.find((o) => o.id === actor.organizationId);
  return (
    <AppShell user={{ name: user.name, email: user.email }} organizationName={org?.name ?? "Workspace"} isAdmin={isPlatformAdmin(user.email)}>
      {children}
    </AppShell>
  );
}
