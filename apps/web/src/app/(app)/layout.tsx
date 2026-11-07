import { countNewFeedback, listOrganizationsForUser, resolvePlatformAdmin } from "@consyrion/db";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSessionUser, requirePageActor } from "@/lib/server/actor";
import { isPlatformAdmin, platformAdminEmails, platformAdminOptions } from "@/lib/server/admin";
import { getDb } from "@/lib/server/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const actor = await requirePageActor();
  const db = await getDb();
  const orgs = await listOrganizationsForUser(db, user.id);
  const org = orgs.find((o) => o.id === actor.organizationId);
  const t = await getTranslations("shell");
  const isAdmin = isPlatformAdmin(user);
  // "New" counter of the feedback inbox next to the Admin entry (#295).
  const newFeedback = isAdmin ? await countNewFeedback(db, await resolvePlatformAdmin(db, user.id, platformAdminEmails(), platformAdminOptions())) : 0;
  return (
    <AppShell user={{ name: user.name, email: user.email }} organizationName={org?.name ?? t("workspace")} isAdmin={isAdmin} adminBadge={newFeedback}>
      {children}
    </AppShell>
  );
}
