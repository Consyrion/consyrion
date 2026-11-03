import { getSessionView } from "@consyrion/council";
import { can, DomainError } from "@consyrion/core";
import { notFound } from "next/navigation";
import { SessionWorkspace } from "@/components/session/workspace";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import type { SessionViewJson } from "@/lib/types";

export const metadata = { title: "Council session" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const view = await getSessionView(await getDb(), actor, (await params).id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const initial = JSON.parse(JSON.stringify(view)) as SessionViewJson;
  return <SessionWorkspace initial={initial} canRun={can(actor.role, "decision:run")} canApprove={can(actor.role, "decision:approve")} />;
}
