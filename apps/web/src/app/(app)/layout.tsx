import { can, DEFAULT_PLAN, isSelfHosted } from "@consyrium/core";
import { countNewFeedback, countUnreadFeedbackReplies, getEntitlements, listOrganizationsForUser, resolvePlatformAdmin } from "@consyrium/db";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSessionUser, requirePageActor } from "@/lib/server/actor";
import { isPlatformAdmin, platformAdminEmails, platformAdminOptions } from "@/lib/server/admin";
import { getDb } from "@/lib/server/db";
import { onlineCheckoutOpen } from "@/lib/server/stripe";

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
  // Unread answers to the user's own reports (#295 stage 3), next to "Feedback & bugs".
  const unreadReplies = await countUnreadFeedbackReplies(db, actor);
  // Upgrade entry in the sidebar (owner request 08.11.26): only on the free plan, only for people who may manage
  // billing, and only while online checkout is open. Checked in this order so most pages need no Stripe lookup.
  const showUpgrade =
    !isSelfHosted() &&
    can(actor.role, "billing:manage") &&
    (await getEntitlements(db, actor.organizationId)).plan === DEFAULT_PLAN &&
    (await onlineCheckoutOpen());
  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      organizationName={org?.name ?? t("workspace")}
      isAdmin={isAdmin}
      adminBadge={newFeedback}
      feedbackBadge={unreadReplies}
      showUpgrade={showUpgrade}
    >
      {children}
    </AppShell>
  );
}
