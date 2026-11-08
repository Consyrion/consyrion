import { can, DomainError, suggestRoles } from "@consyrion/core";
import { getEntitlements, getPlanCatalog, getProject, getSkillForUse, listSkills, proposeRequirementList } from "@consyrion/db";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { RequirementIntake, type IntakeProposal } from "@/components/requirement-intake";
import { SkillPicker } from "@/components/skills/skill-picker";
import { TeamConfig, type SkillPrefill } from "@/components/team-config";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  return { title: (await getTranslations("councilSetup"))("metaTitle") };
}

export default async function CouncilSetupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ skill?: string }> }) {
  const actor = await requirePageActor();
  const id = (await params).id;
  if (!can(actor.role, "decision:run")) redirect(`/projects/${id}`);
  const db = await getDb();
  const project = await getProject(db, actor, id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // The plan limit is shown and enforced in the form; the server checks it again when the session starts.
  const [{ plan, entitlements }, proposal, catalog] = await Promise.all([
    getEntitlements(db, actor.organizationId),
    proposeRequirementList(db, actor, id),
    getPlanCatalog(db),
  ]);
  // The plan's display name (billing page: "Free"), not its internal key ("starter") – night test 07.11.26.
  const planName = catalog.find((p) => p.key === plan)?.name ?? plan;
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
          items: proposal.latest.items.map((i) => ({ id: i.id, text: i.text, measure: i.measure ?? null, splitFrom: i.splitFrom ?? null })),
          excluded: proposal.latest.excluded.map((e) => ({ text: e.text, reason: e.reason })),
          noHardRequirements: proposal.latest.noHardRequirements,
          briefVersion: proposal.latest.sourceState.briefVersion,
          confirmedAt: proposal.latest.confirmedAt.toISOString(),
        }
      : null,
    items: proposal.items,
    excluded: proposal.excluded,
    toDecide: proposal.toDecide,
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
  // Skills (#363): the chosen skill pre-fills the setup; requirement blocks stay proposals in the intake.
  const skills = await listSkills(db, actor);
  const skillId = (await searchParams).skill;
  const chosen = skillId ? await getSkillForUse(db, actor, skillId).catch(() => null) : null;
  // #420: dismissed blocks are remembered per project and skill version (in the browser; a reading aid, not a decision).
  const blocksKey = chosen ? `consyrion.skillBlocks.dismissed:${project.id}:${chosen.ref.skillId}@${chosen.ref.contentHash}` : null;
  const blockList = chosen?.content.requirementBlocks ?? [];
  const prefill: SkillPrefill | null = chosen
    ? {
        id: chosen.ref.skillId,
        version: chosen.ref.version,
        name: chosen.ref.name,
        mode: chosen.content.council?.mode,
        models: chosen.content.council?.models,
        roles: chosen.content.roles,
        weights: chosen.content.weights,
        sessionRules: chosen.content.sessionRules,
        blocks:
          blockList.length && blocksKey
            ? { list: blockList, confirmed: proposal.current ? (proposal.latest?.items.map((i) => i.text) ?? []) : [], storageKey: blocksKey }
            : undefined,
      }
    : null;
  const t = await getTranslations("councilSetup");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-4">
        <SkillPicker
          value={chosen?.ref.skillId ?? null}
          options={skills.map((s) => ({
            id: s.id,
            name: s.name,
            group: s.visibility === "official" ? "official" : s.visibility === "team" && !s.editable ? "team" : "own",
          }))}
        />
      </div>
      <div className="mb-6">
        <RequirementIntake
          key={`${intake.source.hash}:${intake.latest?.version ?? 0}`}
          projectId={project.id}
          proposal={intake}
          canWrite={can(actor.role, "project:write")}
          skill={chosen ? { name: chosen.ref.name, blocks: blockList, storageKey: blocksKey ?? undefined } : null}
        />
      </div>
      <TeamConfig
        key={chosen ? `${chosen.ref.skillId}@${chosen.ref.contentHash}` : "no-skill"}
        skill={prefill}
        projectId={project.id}
        projectName={project.name}
        planName={planName}
        maxModels={entitlements.maxParticipantsPerSession}
        requirementsConfirmed={proposal.current}
        roleSuggestion={roleSuggestion}
      />
    </>
  );
}
