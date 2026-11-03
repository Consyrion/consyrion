import { can } from "@consyrion/core";
import { getEntitlements, listDeliveryConnections, listGitHubIntegrations } from "@consyrion/db";
import { DeliveryConnections } from "@/components/delivery";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/surface";
import { getSessionUser, requirePageActor } from "@/lib/server/actor";
import { isPlatformAdmin } from "@/lib/server/admin";
import { getDb } from "@/lib/server/db";
import { githubConfig } from "@/lib/server/github";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const actor = await requirePageActor();
  const db = await getDb();
  const [integrations, { plan, entitlements }, deliveryConnections] = await Promise.all([
    listGitHubIntegrations(db, actor),
    getEntitlements(db, actor.organizationId),
    listDeliveryConnections(db, actor),
  ]);
  const configured = Boolean(githubConfig());
  // Show the plan limit before the user installs anything, not on the last click.
  const allowed = entitlements.github;
  const canManage = can(actor.role, "org:manage");
  const platformAdmin = isPlatformAdmin((await getSessionUser())?.email ?? "");
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Send decisions to e-mail, Telegram or Confluence, and optionally connect GitHub: councils read the repository files you choose on a project as context, and approved decisions are built as draft pull requests."
      />
      {(await searchParams).connected ? (
        <div className="mb-4">
          <Alert tone="success">GitHub connected.</Alert>
        </div>
      ) : null}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">GitHub</h2>
            <p className="text-sm text-muted">
              Least privilege: you choose the repositories on GitHub. CONSYRION AI reads code, writes only to new branches and opens draft pull requests. It
              never merges.
            </p>
          </div>
          {configured && canManage && allowed ? (
            <a className={buttonClasses()} href="/api/github/install">
              {integrations.length ? "Add another installation" : "Connect GitHub"}
            </a>
          ) : null}
        </div>
        {!configured ? (
          <div className="mt-4">
            <Alert tone="warning">
              {platformAdmin
                ? "The GitHub App is not configured on this server yet. Create it and set the GITHUB_APP_* variables (docs/github-app.md)."
                : "GitHub is not available on this CONSYRION AI installation yet. Councils still work without a repository; the operator can enable GitHub."}
            </Alert>
          </div>
        ) : null}
        {configured && !allowed ? (
          <div className="mt-4">
            <Alert tone="warning">
              GitHub is not included in your current plan ({plan}). It is available from the Pro plan –{" "}
              <Link href="/settings/billing" className="underline">
                see Billing &amp; usage
              </Link>
              .
            </Alert>
          </div>
        ) : null}
        {!canManage ? <p className="mt-3 text-sm text-muted">Only owners can connect GitHub.</p> : null}
        <ul className="mt-4 divide-y divide-line">
          {integrations.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-3 text-sm">
              <span>
                <strong>{i.accountLogin}</strong> <span className="text-muted">({i.accountType})</span>
              </span>
              <Badge>{i.repositorySelection === "all" ? "all repositories" : "selected repositories"}</Badge>
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
