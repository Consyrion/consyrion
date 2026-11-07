import { assertCan, DomainError } from "@consyrion/core";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../client";
import { councilParticipant, councilSession } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { createProject } from "./projects";
import { confirmRequirementList, proposeRequirementList } from "./requirements";

/**
 * Decision requests from external clients (MCP `ask_consyrion`, 06.11.26): someone working in Claude, Cursor … asks
 * CONSYRION for a decision in one call. The requirements come from the user in that client, and the client asks the
 * user before the call – that approval is the human confirmation of the requirement list. Everything else uses the
 * normal repositories (plan limits, permissions, audit).
 */
export interface DecisionRequest {
  question: string;
  context: string;
  options: string[];
  requirements: string[];
}

export async function createProjectForDecisionRequest(db: Database, ctx: ActorContext, input: DecisionRequest, via: "mcp" | "telegram") {
  assertCan(ctx.role, "project:write");
  const question = input.question.replace(/\s+/g, " ").trim();
  if (question.length < 5) throw new DomainError("VALIDATION", "Ask a question of at least 5 characters");
  const context = input.context.trim();
  const options = input.options.map((o) => o.replace(/\s+/g, " ").trim()).filter(Boolean);
  const requirements = input.requirements.map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean);
  const idea = [question, context, options.length ? `Options to compare:\n${options.map((o) => `- ${o}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
  const project = await createProject(db, ctx, {
    name: question.slice(0, 120),
    type: "technology_choice",
    intent: "decision",
    status: "ready",
    brief: {
      idea: idea.length >= 20 ? idea : `${idea} – decision requested via ${via.toUpperCase()}`,
      goal: question,
      requirements: requirements.map((r) => `- ${r}`).join("\n"),
    },
  });

  // Confirm the list as proposed from the user's own text: their requirement lines are kept, sentences of the question
  // and context are context. Statements that look like instructions to the models are never decided automatically.
  const proposal = await proposeRequirementList(db, ctx, project.id);
  if (proposal.toDecide.length)
    throw new DomainError(
      "VALIDATION",
      `Some statements look like instructions to the models and need a human decision: ${proposal.toDecide.map((t) => `"${t.text.slice(0, 60)}"`).join(", ")}. Rephrase them as plain requirements.`,
    );
  // Only the requirement lines the user gave are confirmed. A sentence of the question or context that merely sounds
  // binding ("max. 50 users", "backups needed") would otherwise become a hard requirement nobody saw – the web flow shows
  // such items for review, this flow confirms without a screen (QA 07.11.26). They stay context, listed as excluded.
  const confirmed = proposal.items.filter((i) => i.source.kind === "requirements");
  const fromContext = proposal.items.filter((i) => i.source.kind !== "requirements" && i.candidateKey);
  await confirmRequirementList(db, ctx, project.id, {
    sourceHash: proposal.source.hash,
    items: confirmed.map((i) => ({ text: i.text, candidateKey: i.candidateKey })),
    excluded: [
      ...proposal.excluded.map((e) => ({ candidateKey: e.candidateKey, reason: e.reason })),
      ...fromContext.map((i) => ({ candidateKey: i.candidateKey!, reason: "Context of the question, not a requirement the user listed" })),
    ],
    noHardRequirements: confirmed.length === 0,
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: `${via}.decision_requested`,
    targetType: "project",
    targetId: project.id,
    metadata: { requirements: confirmed.length, options: options.length, confirmedVia: via },
  });
  return { project, requirements: confirmed.map((i) => i.text) };
}

/** The models of the workspace's most recent council (keys still present) – "the same models as last time". */
export async function lastCouncilParticipants(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "decision:run");
  const [latest] = await db
    .select({ id: councilSession.id })
    .from(councilSession)
    .where(eq(councilSession.organizationId, ctx.organizationId))
    .orderBy(desc(councilSession.createdAt))
    .limit(1);
  if (!latest) return [];
  return db
    .select({ credentialId: councilParticipant.credentialId, modelId: councilParticipant.modelId, provider: councilParticipant.provider })
    .from(councilParticipant)
    .where(
      and(eq(councilParticipant.sessionId, latest.id), eq(councilParticipant.organizationId, ctx.organizationId), isNotNull(councilParticipant.credentialId)),
    )
    .orderBy(asc(councilParticipant.position)) as Promise<Array<{ credentialId: string; modelId: string; provider: string }>>;
}
