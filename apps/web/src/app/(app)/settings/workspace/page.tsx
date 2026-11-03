import { can } from "@consyrion/core";
import { listOrganizationsForUser } from "@consyrion/db";
import { DangerDelete, WorkspaceSwitcher } from "@/components/saas";
import { buttonClasses } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export const metadata = { title: "Workspace" };

export default async function WorkspacePage() {
  const actor = await requirePageActor();
  const orgs = await listOrganizationsForUser(await getDb(), actor.userId);
  const current = orgs.find((o) => o.id === actor.organizationId)!;
  const owner = can(actor.role, "org:manage");
  return (
    <>
      <PageHeader title="Workspace" description="Switch workspaces, export your data or delete the workspace." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <WorkspaceSwitcher organizations={orgs.map((o) => ({ id: o.id, name: o.name, role: o.role }))} active={actor.organizationId} />
        </Card>
        {owner ? (
          <Card>
            <h2 className="font-semibold">Data export</h2>
            <p className="mt-1 text-sm text-muted">All projects, councils, decisions, runs, usage and audit events of this workspace as JSON. API keys are never exported.</p>
            <a className={`${buttonClasses("secondary")} mt-3`} href="/api/privacy/export">
              Download export
            </a>
          </Card>
        ) : null}
      </div>
      {owner ? (
        <Card className="mt-6 border-danger/40">
          <h2 className="font-semibold text-danger">Delete workspace</h2>
          <p className="mt-1 mb-3 text-sm text-muted">Permanently deletes all projects, sessions, generated code, documents, keys and audit data of “{current.name}”. This cannot be undone.</p>
          <DangerDelete url="/api/privacy/organization" method="DELETE" name={current.name} label="Delete workspace permanently" redirectTo="/dashboard" />
        </Card>
      ) : null}
    </>
  );
}
