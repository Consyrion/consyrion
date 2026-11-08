import { getSessionView } from "@consyrion/council";
import { can, DomainError } from "@consyrion/core";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DemoNotice } from "@/components/demo-notice";
import { SessionWorkspace } from "@/components/session/workspace";
import { SessionDelete } from "@/components/session/session-delete";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import type { SessionViewJson } from "@/lib/types";

export async function generateMetadata() {
  return { title: (await getTranslations("councilSetup"))("sessionTitle") };
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const view = await getSessionView(await getDb(), actor, (await params).id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const initial = JSON.parse(JSON.stringify(view)) as SessionViewJson;
  // The demo project is read-only (owner decision 08.11.26): no new runs, approvals or builds.
  const demo = view.project.isDemo;
  return (
    <>
      {demo ? <DemoNotice /> : null}
      <SessionWorkspace initial={initial} canRun={!demo && can(actor.role, "decision:run")} canApprove={!demo && can(actor.role, "decision:approve")} />
      {/* #198: delete this whole session – owners/admins, not in the demo project. */}
      {!demo && can(actor.role, "project:delete") ? (
        <SessionDelete
          sessionId={view.session.id}
          projectName={view.project.name}
          running={["queued", "running", "cancel_requested"].includes(view.session.status)}
        />
      ) : null}
    </>
  );
}
