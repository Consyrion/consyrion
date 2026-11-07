import { can, isSelfHosted, isUnlimited, type Entitlements } from "@consyrion/core";
import { approximateCost, getEntitlements, getPlanCatalog, getSubscription, listPriceHints, usageThisMonth } from "@consyrion/db";
import { getFormatter, getTranslations } from "next-intl/server";
import { DeleteHint, PortalButton, PriceHintForm, UpgradeButton } from "@/components/saas";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import { getStripeConfig } from "@/lib/server/stripe";
import { hasPlaceholders } from "@/lib/legal";

export async function generateMetadata() {
  const t = await getTranslations("settings.pages");
  return { title: t("billing.title") };
}

/** `limitLabel` is the translated limit ("unlimited", "not included" or the number). */
function Meter({ label, used, limit, limitLabel }: { label: string; used: number; limit: number; limitLabel: string }) {
  const unlimited = isUnlimited(limit);
  const pct = unlimited ? 0 : limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  return (
    <div className="text-sm">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="text-muted">
          {used} / {limitLabel}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-surface-2" role="progressbar" aria-valuenow={used} aria-valuemax={limit} aria-label={label}>
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-danger" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const actor = await requirePageActor();
  const t = await getTranslations("settings.billing");
  const format = await getFormatter();
  if (isSelfHosted())
    return (
      <>
        <PageHeader title={t("title")} description={t("selfHostedDescription")} />
        <Card>
          <p className="text-sm text-muted">{t("selfHostedText")}</p>
        </Card>
      </>
    );
  const db = await getDb();
  const [{ plan, entitlements: e }, sub, catalog, usage, hints] = await Promise.all([
    getEntitlements(db, actor.organizationId),
    getSubscription(db, actor.organizationId),
    getPlanCatalog(db),
    usageThisMonth(db, actor.organizationId),
    listPriceHints(db, actor),
  ]);
  const stripeConfig = await getStripeConfig();
  // Live checkout stays closed while the legal pages are drafts (same rule as /api/billing/checkout).
  const stripe = Boolean(stripeConfig) && !(/^(sk|rk)_live_/.test(stripeConfig!.secretKey) && hasPlaceholders());
  const canBill = can(actor.role, "billing:manage");
  const limitText = (limit: number) => (isUnlimited(limit) ? t("unlimited") : String(limit));
  const meterLimit = (limit: number) => (isUnlimited(limit) ? t("unlimited") : limit === 0 ? t("notIncluded") : String(limit));
  const meter = (label: string, used: number, limit: number) => <Meter label={label} used={used} limit={limit} limitLabel={meterLimit(limit)} />;
  const statusKey = `status.${sub.status}`;
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {(await searchParams).checkout === "success" ? (
        <div className="mb-4">
          <Alert tone="success">{t("checkoutSuccess")}</Alert>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{t("currentPlan")}</h2>
            <Badge tone="accent">{catalog.find((p) => p.key === plan)?.name ?? plan}</Badge>
            {sub.status !== "active" ? <Badge tone="warning">{t.has(statusKey) ? t(statusKey) : sub.status}</Badge> : null}
          </div>
          {/* Only a Stripe subscription renews; a manual plan (e.g. after a forgotten test-mode customer) shows no date. */}
          {sub.currentPeriodEnd && sub.provider === "stripe" ? (
            <p className={`mt-1 text-sm ${sub.cancelAtPeriodEnd ? "text-warning" : "text-muted"}`}>
              {t(sub.cancelAtPeriodEnd ? "endsOn" : "renews", { date: format.dateTime(sub.currentPeriodEnd, { dateStyle: "medium" }) })}
            </p>
          ) : null}
          <div className="mt-4 space-y-3">
            {meter(t("meterMembers"), usage.members + usage.pendingInvitations, e.maxMembers)}
            {meter(t("meterProjects"), usage.projects, e.maxProjects)}
            {meter(t("meterSessions"), usage.sessions, e.maxSessionsPerMonth)}
            {meter(t("meterExecutions"), usage.executions, e.executionCouncil ? e.maxExecutionsPerMonth : 0)}
            {/* Hosted plans run no sandbox (tests run in the user's GitHub Actions); only show the meter where it applies. */}
            {e.maxSandboxMinutesPerMonth > 0 ? meter(t("meterSandbox"), usage.sandboxMinutes, e.maxSandboxMinutesPerMonth) : null}
          </div>
          <p className="mt-3 text-sm text-muted">{t(e.github ? "planSummaryGithub" : "planSummaryNoGithub", { models: e.maxParticipantsPerSession })}</p>
          {canBill && sub.provider === "stripe" ? (
            <div className="mt-4">
              <PortalButton />
            </div>
          ) : null}
        </Card>
        <Card>
          <h2 className="font-semibold">{t("plans")}</h2>
          {!stripe ? <p className="mt-1 text-sm text-muted">{t("noCheckout")}</p> : null}
          <ul className="mt-3 space-y-3">
            {catalog
              .filter((p) => p.active)
              .map((p) => {
                const ent = p.entitlements as unknown as Entitlements;
                return (
                  <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
                    <span>
                      <strong>{p.name}</strong> {p.priceLabel ? <span className="text-muted">· {p.priceLabel}</span> : null}
                      <span className="block text-muted">
                        {t("planLimits", {
                          members: ent.maxMembers,
                          projects: limitText(ent.maxProjects),
                          sessions: limitText(ent.maxSessionsPerMonth),
                          models: ent.maxParticipantsPerSession,
                          build: ent.executionCouncil && ent.github ? "yes" : "no",
                          mcp: ent.mcp ? "yes" : "no",
                        })}
                      </span>
                    </span>
                    {p.key === plan ? (
                      <Badge tone="success">{t("current")}</Badge>
                    ) : canBill && stripe && p.stripePriceId ? (
                      <UpgradeButton plan={p.key} label={t("choose", { name: p.name })} />
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </Card>
      </div>
      <Card className="mt-6">
        <h2 className="font-semibold">{t("usageTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("usageText")}</p>
        {usage.models.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("noCalls")}</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2">{t("colModel")}</th>
                <th>{t("colCalls")}</th>
                <th>{t("colFailed")}</th>
                <th>{t("colInput")}</th>
                <th>{t("colOutput")}</th>
                <th>{t("colCost")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {usage.models.map((m) => {
                const hint = hints.find((h) => h.provider === m.provider && h.modelId === m.modelId);
                const cost = approximateCost(hint, m.inputTokens, m.outputTokens);
                return (
                  <tr key={`${m.provider}:${m.modelId}`}>
                    <td className="py-2">
                      {m.provider} · {m.modelId}
                    </td>
                    <td>{m.calls}</td>
                    <td>{m.failed}</td>
                    <td>{format.number(m.inputTokens)}</td>
                    <td>{format.number(m.outputTokens)}</td>
                    <td>{cost === null ? "–" : `${cost.toFixed(2)} ${hint!.currency}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {can(actor.role, "credential:write") ? (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-medium">{t("pricesTitle")}</h3>
            <ul className="mb-3 space-y-1 text-sm">
              {hints.map((h) => (
                <li key={h.id} className="flex items-center gap-2">
                  {t("priceHint", {
                    provider: h.provider,
                    model: h.modelId,
                    input: String(h.inputPerMillion),
                    output: String(h.outputPerMillion),
                    currency: h.currency,
                  })}{" "}
                  <DeleteHint id={h.id} />
                </li>
              ))}
            </ul>
            <PriceHintForm />
          </div>
        ) : null}
      </Card>
    </>
  );
}
