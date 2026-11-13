import { listOrganizationsForUser, OAUTH_TOKEN_DAYS } from "@consyrium/db";
import { redirectTarget } from "@consyrium/core";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui/surface";
import { withNext } from "@/lib/safe-next";
import { getSessionUser, requireActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import { authorizeQuery, readAuthorizeRequest } from "@/lib/server/oauth";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth.oauth");
  return { title: t("metaTitle"), robots: { index: false } };
}

/**
 * Consent page of the OAuth sign-in (authorization endpoint, docs/mcp.md "Sign-in (OAuth)"): an MCP client or the
 * Obsidian plugin sends the user here; after "Allow" the client receives a one-time code at its registered redirect
 * URI and exchanges it for an API token.
 *
 * Anybody can register a client, so the page shows where the access goes (scheme and host of the redirect URI) more
 * prominently than the name the client gave itself. A request that does not validate is explained here and never
 * redirected – the redirect URI of an invalid request is not trusted. Signed-out visitors sign in first and come back.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("auth.oauth");
  const db = await getDb();
  const parsed = await readAuthorizeRequest(db, await searchParams);
  if (!parsed.ok) {
    return (
      <AuthShell>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">{t("errorTitle")}</h1>
        <div className="mt-4">
          <Alert>{t(`problem.${parsed.problem}`)}</Alert>
        </div>
        <p className="mt-4 text-sm text-muted">{t("errorHint")}</p>
      </AuthShell>
    );
  }
  const request = parsed.request;
  const query = authorizeQuery(request);
  const user = await getSessionUser();
  if (!user) redirect(withNext("/sign-in", `/oauth/authorize?${query}`));
  const actor = await requireActor({ sessionOnly: true });
  const workspace = (await listOrganizationsForUser(db, user.id)).find((org) => org.id === actor.organizationId);
  const target = redirectTarget(request.redirectUri);

  return (
    <AuthShell>
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">{t("title", { client: request.client.name })}</h1>
      <p className="mt-2 text-sm text-muted">{t("signedInAs", { email: user.email })}</p>

      <dl className="mt-6 space-y-4 text-sm">
        <div className="rounded-lg border border-primary/60 bg-surface-2 px-4 py-3">
          <dt className="text-muted">{t("targetLabel")}</dt>
          <dd className="mt-1 font-mono text-base font-semibold break-all text-text">{target}</dd>
          <dd className="mt-2 text-muted">{request.client.firstParty ? t("targetFirstParty") : t("targetUnverified")}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("workspaceLabel")}</dt>
          <dd className="mt-1 font-semibold">{workspace?.name ?? actor.organizationId}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("scopeLabel")}</dt>
          <dd className="mt-1">{t(`scope.${request.scope}`)}</dd>
          <dd className="mt-2 text-muted">{t("validity", { days: OAUTH_TOKEN_DAYS })}</dd>
        </div>
      </dl>

      <ConsentForm query={query} organizationId={actor.organizationId} target={target} />
    </AuthShell>
  );
}
