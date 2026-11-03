import { can } from "@consyrion/core";
import { listProjects } from "@consyrion/db";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export const metadata = { title: "Projects" };

const TYPE_LABELS: Record<string, string> = {
  idea: "Idea",
  architecture: "Architecture",
  repository: "Repository",
  business: "Business",
  technology_choice: "Technology choice",
};

export default async function ProjectsPage() {
  const actor = await requirePageActor();
  const projects = (await listProjects(await getDb(), actor)).filter((p) => p.status !== "archived");
  const canWrite = can(actor.role, "project:write");
  const newButton = canWrite ? (
    <Link href="/projects/new" className={buttonClasses()}>
      New project
    </Link>
  ) : null;

  return (
    <>
      <PageHeader title="Projects" description="Every council session starts from a versioned project brief." actions={newButton} />
      {projects.length === 0 ? (
        <EmptyState title="No projects yet" description="Describe an idea or architecture question to prepare your first council session." action={newButton} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 hover:bg-surface-2">
                <span className="font-medium">{project.name}</span>
                <span className="flex items-center gap-2">
                  <Badge tone="accent">{TYPE_LABELS[project.type] ?? project.type}</Badge>
                  <Badge>{project.status}</Badge>
                  <time className="text-xs text-muted" dateTime={project.updatedAt.toISOString()}>
                    {project.updatedAt.toLocaleDateString("en-GB")}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
