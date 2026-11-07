import { can } from "@consyrion/core";
import { getEntitlements, listDeliveryConnections, listGitHubIntegrations } from "@consyrion/db";
import { getTranslations } from "next-intl/server";
import { DeliveryConnections } from "@/components/delivery";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/surface";
import { getSessionUser, requirePageActor } from "@/lib/server/actor";
import { isPlatformAdmin } from "@/lib/server/admin";
import { getDb } from "@/lib/server/db";
import { githubConfig } from "@/lib/server/github";

export async function generateMetadata() {
  const t = await getTranslations("settings.pages");
  return { title: t("integrations.title") };
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const actor = await requirePageActor();
  const db = await getDb();
  const [integrations, { plan, entitlements }, deliveryConnections] = await Promise.all([
    listGitHubIntegrations(db, actor),
    getEntitlements(db, actor.organizationId),
    listDeliveryConnections(db, actor),
  ]);
  const t = await getTranslations("settings.pages.integrations");
  const configured = Boolean(githubConfig());
  // Show the plan limit before the user installs anything, not on the last click.
  const allowed = entitlements.github;
  const canManage = can(actor.role, "org:manage");
  const platformAdmin = isPlatformAdmin(await getSessionUser());
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {(await searchParams).connected ? (
        <div className="mb-4">
          <Alert tone="success">{t("connected")}</Alert>
        </div>
      ) : null}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">GitHub</h2>
            <p className="text-sm text-muted">{t("githubText")}</p>
          </div>
          {configured && canManage && allowed ? (
            <a className={buttonClasses()} href="/api/github/install">
              {integrations.length ? t("addInstallation") : t("connectGithub")}
            </a>
          ) : null}
        </div>
        {!configured ? (
          <div className="mt-4">
            <Alert tone="warning">{platformAdmin ? t("notConfiguredAdmin") : t("notConfigured")}</Alert>
          </div>
        ) : null}
        {configured && !allowed ? (
          <div className="mt-4">
            <Alert tone="warning">
              {t.rich("notInPlan", {
                plan,
                link: (chunks) => (
                  <Link href="/settings/billing" className="underline">
                    {chunks}
                  </Link>
                ),
              })}
            </Alert>
          </div>
        ) : null}
        {!canManage ? <p className="mt-3 text-sm text-muted">{t("ownersOnly")}</p> : null}
        <ul className="mt-4 divide-y divide-line">
          {integrations.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-3 text-sm">
              <span>
                <strong>{i.accountLogin}</strong> <span className="text-muted">({i.accountType})</span>
              </span>
              <Badge>{i.repositorySelection === "all" ? t("allRepositories") : t("selectedRepositories")}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <div className="mt-6">
        <DeliveryConnections
          initial={deliveryConnections.map((c) => ({ ...c, kind: c.kind as "telegram" | "confluence" }))}
          canWrite={can(actor.role, "credential:write")}
          emailConfigured={Boolean(process.env.SMTP_URL?.trim())}
        />
      </div>
    </>
  );
}
