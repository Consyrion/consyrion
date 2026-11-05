import { stripeStatus } from "@consyrion/billing";
import { getPlanCatalog, getSubscription, platformOverview } from "@consyrion/db";
import { notFound } from "next/navigation";
import { AdminPlanEditor, AdminPlanSelect, AdminStripeSetup } from "@/components/saas";
import { Card, PageHeader } from "@/components/ui/surface";
import { requireUser } from "@/lib/server/actor";
import { isPlatformAdmin } from "@/lib/server/admin";
import { getDb } from "@/lib/server/db";

export const metadata = { title: "Admin" };

/** Platform administration (PLATFORM_ADMIN_EMAILS). Hidden (404) for everybody else. */
export default async function AdminPage() {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) notFound();
  const db = await getDb();
  const [overview, catalog, stripe] = await Promise.all([platformOverview(db), getPlanCatalog(db), stripeStatus(db)]);
  const organizations = overview.list;
  const plans = await Promise.all(organizations.map((o) => getSubscription(db, o.id)));
  return (
    <>
      <PageHeader title="Platform admin" description="Workspaces, plans and limits. Visible only to platform administrators." />
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Users", overview.users],
          ["Workspaces", overview.organizations],
          ["Council sessions", overview.sessions],
          ["Execution runs", overview.executions],
        ].map(([label, value]) => (
          <Card key={label}>
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-1 text-3xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <h2 className="font-semibold">Workspaces</h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2">Name</th>
              <th>Members</th>
              <th>Created</th>
              <th>Plan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {organizations.map((o, i) => (
              <tr key={o.id}>
                <td className="py-2">{o.name}</td>
                <td>{o.members}</td>
                <td>{o.createdAt.toLocaleDateString("en-GB")}</td>
                <td>
                  <AdminPlanSelect organizationId={o.id} plan={plans[i]!.plan} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="mt-6">
        <h2 className="mb-3 font-semibold">Stripe and Pro price</h2>
        <AdminStripeSetup status={stripe} />
      </Card>
      <Card className="mt-6">
        <h2 className="font-semibold">Plan catalog</h2>
        <p className="mt-1 mb-3 text-sm text-muted">Limits are enforced server-side. Limits of 1,000,000 or more mean unlimited. The Pro price and its Stripe price are set above. CONSYRION AI never bills AI tokens.</p>
        <div className="space-y-4">
          {catalog.map((p) => (
            <AdminPlanEditor key={p.key} plan={{ key: p.key, name: p.name, entitlements: p.entitlements as Record<string, number | boolean>, priceLabel: p.priceLabel, stripePriceId: p.stripePriceId, active: p.active }} />
          ))}
        </div>
      </Card>
    </>
  );
}
