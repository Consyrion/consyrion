import { listSessions } from "@consyrion/council";
import { DECISION_MODE_LABELS } from "@consyrion/core";
import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export const metadata = { title: "Decisions" };

export default async function DecisionsPage() {
  const actor = await requirePageActor();
  const sessions = await listSessions(await getDb(), actor);
  return (
    <>
      <PageHeader title="Decisions" description="All council sessions of this workspace." />
      {sessions.length === 0 ? (
        <EmptyState title="No council sessions yet" description="Open a project and start a council to get a decision." />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/sessions/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 hover:bg-surface-2">
                <span>
                  <span className="font-medium">{s.projectName}</span>
                  <span className="block text-sm text-muted">{DECISION_MODE_LABELS[s.mode]}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge>{s.status.replaceAll("_", " ")}</Badge>
                  <span className="text-xs text-muted">{s.createdAt.toLocaleString("en-GB")}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
