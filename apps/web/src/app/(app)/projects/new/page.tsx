import { can } from "@consyrium/core";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ProjectForm } from "@/components/project-form";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";

export async function generateMetadata() {
  return { title: (await getTranslations("projects"))("newTitle") };
}

export default async function NewProjectPage() {
  const actor = await requirePageActor();
  if (!can(actor.role, "project:write")) redirect("/projects");
  const t = await getTranslations("projects");
  return (
    <>
      <PageHeader title={t("newTitle")} description={t("newDescription")} />
      <ProjectForm />
    </>
  );
}
