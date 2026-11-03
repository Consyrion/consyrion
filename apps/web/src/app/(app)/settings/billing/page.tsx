import { stripeConfigFromEnv } from "@consyrion/billing";
import { can, isSelfHosted, type Entitlements } from "@consyrion/core";
import { approximateCost, getEntitlements, getPlanCatalog, getSubscription, listPriceHints, usageThisMonth } from "@consyrion/db";
import { DeleteHint, PortalButton, PriceHintForm, UpgradeButton } from "@/components/saas";
import { Alert, Badge, Card, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export const metadata = { title: "Billing and usage" };

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  return (
    <div className="text-sm">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="text-muted">
          {used} / {limit === 0 ? "not included" : limit}
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
  if (isSelfHosted())
    return (
      <>
        <PageHeader title="Billing and usage" description="This is a self-hosted installation: no plans, no limits, no platform fees." />
        <Card>
          <p className="text-sm text-muted">AI usage is billed by your providers directly to your own API keys (BYOK). Manage the keys under Settings → AI providers.</p>
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
  const stripe = Boolean(stripeConfigFromEnv());
  const canBill = can(actor.role, "billing:manage");
  return (
    <>
      <PageHeader title="Billing and usage" description="CONSYRION AI charges only for the platform. AI usage is billed by your providers to your own API keys (BYOK)." />
      {(await searchParams).checkout === "success" ? <div className="mb-4"><Alert tone="success">Thank you. The plan changes as soon as Stripe confirms the payment.</Alert></div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Current plan</h2>
            <Badge tone="accent">{catalog.find((p) => p.key === plan)?.name ?? plan}</Badge>
            {sub.status !== "active" ? <Badge tone="warning">{sub.status}</Badge> : null}
          </div>
          {sub.currentPeriodEnd ? <p className="mt-1 text-sm text-muted">Renews {sub.currentPeriodEnd.toLocaleDateString("en-GB")}</p> : null}
          <div className="mt-4 space-y-3">
            <Meter label="Members (incl. open invitations)" used={usage.members + usage.pendingInvitations} limit={e.maxMembers} />
            <Meter label="Active projects" used={usage.projects} limit={e.maxProjects} />
            <Meter label="Council sessions this month" used={usage.sessions} limit={e.maxSessionsPerMonth} />
            <Meter label="Execution Council runs this month" used={usage.executions} limit={e.executionCouncil ? e.maxExecutionsPerMonth : 0} />
            <Meter label="Sandbox minutes this month" used={usage.sandboxMinutes} limit={e.maxSandboxMinutesPerMonth} />
          </div>
          <p className="mt-3 text-sm text-muted">Up to {e.maxParticipantsPerSession} models per session · GitHub {e.github ? "included" : "not included"}</p>
          {canBill && sub.provider === "stripe" ? <div className="mt-4"><PortalButton /></div> : null}
        </Card>
        <Card>
          <h2 className="font-semibold">Plans</h2>
          {!stripe ? <p className="mt-1 text-sm text-muted">Online checkout is not enabled yet; plans are assigned by CONSYRION AI on request.</p> : null}
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
                        {ent.maxMembers} members · {ent.maxProjects} projects · {ent.maxSessionsPerMonth} sessions/month · Execution Council {ent.executionCouncil ? "yes" : "no"}
                      </span>
                    </span>
                    {p.key === plan ? <Badge tone="success">current</Badge> : canBill && stripe && p.stripePriceId ? <UpgradeButton plan={p.key} label={`Choose ${p.name}`} /> : null}
                  </li>
                );
              })}
          </ul>
        </Card>
      </div>
      <Card className="mt-6">
        <h2 className="font-semibold">AI usage this month (your provider accounts)</h2>
        <p className="mt-1 text-sm text-muted">Observed tokens from CONSYRION AI runs. Costs are approximate and only shown where you entered a price; your provider&apos;s invoice is authoritative.</p>
        {usage.models.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No model calls this month.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2">Model</th>
                <th>Calls</th>
                <th>Failed</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>≈ Cost</th>
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
                    <td>{m.inputTokens.toLocaleString("en-US")}</td>
                    <td>{m.outputTokens.toLocaleString("en-US")}</td>
                    <td>{cost === null ? "–" : `${cost.toFixed(2)} ${hint!.currency}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {can(actor.role, "credential:write") ? (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-medium">Your provider prices (optional, for the estimate)</h3>
            <ul className="mb-3 space-y-1 text-sm">
              {hints.map((h) => (
                <li key={h.id} className="flex items-center gap-2">
                  {h.provider} · {h.modelId}: in {h.inputPerMillion} / out {h.outputPerMillion} {h.currency} per 1M <DeleteHint id={h.id} />
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
