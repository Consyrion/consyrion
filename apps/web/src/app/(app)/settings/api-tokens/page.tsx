import { getEntitlements, listApiTokens } from "@consyrium/db";
import { getTranslations } from "next-intl/server";
import { ApiTokens } from "@/components/api-tokens";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  const t = await getTranslations("settings.pages");
  return { title: t("apiTokens.title") };
}

export default async function ApiTokensPage() {
  const actor = await requirePageActor();
  const t = await getTranslations("settings.pages.apiTokens");
  const db = await getDb();
  const tokens = await listApiTokens(db, actor);
  const { entitlements } = await getEntitlements(db, actor.organizationId);
  const origin = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ApiTokens
        tokens={tokens.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          scope: k.scope,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          expiresAt: k.expiresAt.toISOString(),
        }))}
        mcp={{ url: `${origin}/api/mcp`, allowed: Boolean(entitlements.mcp) }}
      />
    </>
  );
}
