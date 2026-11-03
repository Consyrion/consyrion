import { can } from "@consyrion/core";
import { redirect } from "next/navigation";
import { ProjectForm } from "@/components/project-form";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const actor = await requirePageActor();
  if (!can(actor.role, "project:write")) redirect("/projects");
  return (
    <>
      <PageHeader title="New project" description="Describe what the council should decide." />
      <ProjectForm />
    </>
  );
}
