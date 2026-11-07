import { can, DomainError, suggestRoles } from "@consyrion/core";
import { getEntitlements, getProject, proposeRequirementList } from "@consyrion/db";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { RequirementIntake, type IntakeProposal } from "@/components/requirement-intake";
import { TeamConfig } from "@/components/team-config";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  return { title: (await getTranslations("councilSetup"))("metaTitle") };
}

export default async function CouncilSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const id = (await params).id;
  if (!can(actor.role, "decision:run")) redirect(`/projects/${id}`);
  const db = await getDb();
  const project = await getProject(db, actor, id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // The plan limit is shown and enforced in the form; the server checks it again when the session starts.
  const [{ plan, entitlements }, proposal] = await Promise.all([getEntitlements(db, actor.organizationId), proposeRequirementList(db, actor, id)]);
  // Requirement intake (#190): the server proposes, the user confirms; the start is refused without a current list.
  const intake: IntakeProposal = {
    source: {
      hash: proposal.source.hash,
      briefVersion: proposal.source.briefVersion,
      documents: proposal.source.documents.map((d) => ({ id: d.id, name: d.name })),
    },
    current: proposal.current,
    latest: proposal.latest
      ? {
          version: proposal.latest.version,
          items: proposal.latest.items.map((i) => ({ id: i.id, text: i.text, measure: i.measure ?? null })),
          excluded: proposal.latest.excluded.map((e) => ({ text: e.text, reason: e.reason })),
          noHardRequirements: proposal.latest.noHardRequirements,
          briefVersion: proposal.latest.sourceState.briefVersion,
          confirmedAt: proposal.latest.confirmedAt.toISOString(),
        }
      : null,
    items: proposal.items,
    excluded: proposal.excluded,
    unscannedDocuments: proposal.unscannedDocuments,
    pendingImages: proposal.pendingImages,
    notProposed: proposal.notProposed,
  };
  // #269: suggested perspectives from the brief and the confirmed requirements – deterministic, no model call.
  const roleSuggestion = suggestRoles({
    idea: project.brief?.idea,
    goal: project.brief?.goal,
    requirements: project.brief?.requirements,
    confirmed: proposal.latest?.items ?? [],
  });
  const t = await getTranslations("councilSetup");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-6">
        <RequirementIntake
          key={`${intake.source.hash}:${intake.latest?.version ?? 0}`}
          projectId={project.id}
          proposal={intake}
          canWrite={can(actor.role, "project:write")}
        />
      </div>
      <TeamConfig
        projectId={project.id}
        projectName={project.name}
        planName={plan}
        maxModels={entitlements.maxParticipantsPerSession}
        requirementsConfirmed={proposal.current}
        roleSuggestion={roleSuggestion}
      />
    </>
  );
}
