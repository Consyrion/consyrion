import { PROVIDER_IDS, PROVIDER_LABELS } from "@consyrion/ai";
import { stripeStatus } from "@consyrion/billing";
import {
  countNewFeedback,
  requirementIntakeMetrics,
  getDemoTemplates,
  getPlanCatalog,
  listDemoCandidates,
  getSubscription,
  platformOverview,
  resolvePlatformAdmin,
} from "@consyrion/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AdminDemoTemplates, AdminPlanEditor, AdminPlanSelect, AdminStripeSetup } from "@/components/saas";
import { SkillHubAdmin } from "@/components/skills/skill-hub-admin";
import { buttonClasses } from "@/components/ui/button";
import { Badge, Card, PageHeader } from "@/components/ui/surface";
import { requirePageActor, requireUser } from "@/lib/server/actor";
import { isPlatformAdmin, platformAdminEmails, platformAdminOptions } from "@/lib/server/admin";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  const t = await getTranslations("settings.admin");
  return { title: t("metaTitle") };
}

/** Platform administration (PLATFORM_ADMIN_EMAILS). Hidden (404) for everybody else. */
export default async function AdminPage() {
  const user = await requireUser();
  if (!isPlatformAdmin(user)) notFound();
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  const db = await getDb();
  const tf = await getTranslations("feedback.admin");
  const admin = await resolvePlatformAdmin(db, user.id, platformAdminEmails(), platformAdminOptions());
  const [overview, catalog, stripe, newFeedback, intake] = await Promise.all([
    platformOverview(db),
    getPlanCatalog(db),
    stripeStatus(db),
    countNewFeedback(db, admin),
    requirementIntakeMetrics(db, admin, { days: 30 }),
  ]);
  const organizations = overview.list;
  const plans = await Promise.all(organizations.map((o) => getSubscription(db, o.id)));
  const actor = await requirePageActor();
  const [demoTemplates, demoCandidates] = await Promise.all([getDemoTemplates(db), listDemoCandidates(db, actor)]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-4 md:grid-cols-4">
        {[
          [t("users"), overview.users],
          [t("workspaces"), overview.organizations],
          [t("sessions"), overview.sessions],
          [t("executions"), overview.executions],
        ].map(([label, value]) => (
          <Card key={label}>
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-1 text-3xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>
      {/* #245: how well the requirement intake proposes – counts only, never text, last 30 days. */}
      <Card className="mt-6" data-testid="intake-metrics">
        <h2 className="font-semibold">{t("intake.title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("intake.description", { days: intake.days })}</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted">{t("intake.ratio")}</dt>
            <dd className="text-2xl font-semibold">
              {intake.kept ? `${format.number(intake.proposed / intake.kept, { maximumFractionDigits: 2 })} : 1` : "–"}
            </dd>
            <dd className="text-xs text-muted">{t("intake.ratioDetail", { proposed: intake.proposed, kept: intake.kept, lists: intake.lists })}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t("intake.added")}</dt>
            <dd className="text-2xl font-semibold">{intake.userAdded}</dd>
            <dd className="text-xs text-muted">{t("intake.splitParts", { n: intake.splitParts })}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t("intake.onlyOne")}</dt>
            <dd className="text-2xl font-semibold">
              {intake.onlyOneUnconfirmable} / {intake.withoutQualified}
            </dd>
            <dd className="text-xs text-muted">{t("intake.onlyOneDetail", { verdicts: intake.verdicts })}</dd>
          </div>
        </dl>
      </Card>
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{tf("title")}</h2>
            <p className="mt-1 text-sm text-muted">{tf("description")}</p>
          </div>
          <Link href="/admin/feedback" className={buttonClasses("secondary")}>
            {tf("open")}
            <Badge tone={newFeedback ? "primary" : "neutral"}>{tf("newCount", { count: newFeedback })}</Badge>
          </Link>
        </div>
      </Card>
      <Card className="mt-6">
        <h2 className="font-semibold">{t("workspaces")}</h2>
        {/* The table scrolls inside the card on phones instead of widening the page. */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2">{t("colName")}</th>
                <th>{t("colMembers")}</th>
                <th>{t("colCreated")}</th>
                <th>{t("colPlan")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {organizations.map((o, i) => (
                <tr key={o.id}>
                  <td className="py-2">{o.name}</td>
                  <td>{o.members}</td>
                  <td>{format.dateTime(o.createdAt, { dateStyle: "medium" })}</td>
                  <td>
                    <AdminPlanSelect organizationId={o.id} plan={plans[i]!.plan} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-6">
        <h2 className="mb-3 font-semibold">{t("demo.title")}</h2>
        <AdminDemoTemplates
          templates={demoTemplates}
          candidates={demoCandidates.map((c) => ({ sessionId: c.sessionId, projectName: c.projectName, createdAt: c.createdAt.toISOString() }))}
        />
      </Card>
      <Card className="mt-6" data-testid="skillhub-admin">
        <h2 className="font-semibold">{t("skillHub.title")}</h2>
        <p className="mt-1 mb-3 text-sm text-muted">{t("skillHub.text")}</p>
        <SkillHubAdmin providers={PROVIDER_IDS.map((id) => ({ id, label: PROVIDER_LABELS[id] }))} />
      </Card>
      <Card className="mt-6">
        <h2 className="mb-3 font-semibold">{t("stripeTitle")}</h2>
        <AdminStripeSetup status={stripe} />
      </Card>
      <Card className="mt-6">
        <h2 className="font-semibold">{t("catalogTitle")}</h2>
        <p className="mt-1 mb-3 text-sm text-muted">{t("catalogText")}</p>
        <div className="space-y-4">
          {catalog.map((p) => (
            <AdminPlanEditor
              key={p.key}
              plan={{
                key: p.key,
                name: p.name,
                entitlements: p.entitlements as Record<string, number | boolean>,
                priceLabel: p.priceLabel,
                stripePriceId: p.stripePriceId,
                active: p.active,
              }}
            />
          ))}
        </div>
      </Card>
    </>
  );
}
