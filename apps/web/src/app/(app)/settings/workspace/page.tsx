import { can } from "@consyrion/core";
import { listOrganizationsForUser } from "@consyrion/db";
import { getTranslations } from "next-intl/server";
import { DeletionNotice } from "@/components/deletion-notice";
import { DangerDelete, WorkspaceSwitcher } from "@/components/saas";
import { buttonClasses } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  const t = await getTranslations("settings.pages");
  return { title: t("workspace.title") };
}

export default async function WorkspacePage() {
  const actor = await requirePageActor();
  const orgs = await listOrganizationsForUser(await getDb(), actor.userId);
  const current = orgs.find((o) => o.id === actor.organizationId)!;
  const owner = can(actor.role, "org:manage");
  const t = await getTranslations("settings.pages.workspace");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <WorkspaceSwitcher organizations={orgs.map((o) => ({ id: o.id, name: o.name, role: o.role }))} active={actor.organizationId} />
        </Card>
        {owner ? (
          <Card>
            <h2 className="font-semibold">{t("exportTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{t("exportText")}</p>
            <a className={`${buttonClasses("secondary")} mt-3`} href="/api/privacy/export">
              {t("exportButton")}
            </a>
          </Card>
        ) : null}
      </div>
      {owner ? (
        <Card className="mt-6 border-danger/40">
          <h2 className="font-semibold text-danger">{t("deleteTitle")}</h2>
          <p className="mt-1 mb-3 text-sm text-muted">{t("deleteText", { name: current.name })}</p>
          <DeletionNotice scope="workspace" />
          <DangerDelete url="/api/privacy/organization" method="DELETE" name={current.name} label={t("deleteButton")} redirectTo="/dashboard" />
        </Card>
      ) : null}
    </>
  );
}
