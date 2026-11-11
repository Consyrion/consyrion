import { assertCan, CLIENT_CONTEXT_EXCLUSION_REASON, DomainError } from "@consyrium/core";
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Database } from "../client";
import { auditEvent, councilParticipant, councilSession } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { addClientFileContext, buildClientFileDocument } from "./documents";
import { archiveProject, createProject } from "./projects";
import { confirmRequirementList, proposeRequirementList } from "./requirements";

/**
 * Decision requests from external clients (MCP `ask_consyrium`, 06.11.26): someone working in Claude, Cursor … asks
 * CONSYRIUM for a decision in one call. The requirements come from the user in that client, and the client asks the
 * user before the call – that approval is the human confirmation of the requirement list. Everything else uses the
 * normal repositories (plan limits, permissions, audit).
 */
export interface DecisionRequest {
  question: string;
  context: string;
  options: string[];
  requirements: string[];
  /** Optional file excerpts (path + content, #331), stored as a context document the models read. */
  files?: Array<{ path: string; content: string }>;
}

export async function createProjectForDecisionRequest(db: Database, ctx: ActorContext, input: DecisionRequest, via: "mcp" | "telegram") {
  assertCan(ctx.role, "project:write");
  const question = input.question.replace(/\s+/g, " ").trim();
  if (question.length < 5) throw new DomainError("VALIDATION", "Ask a question of at least 5 characters");
  const context = input.context.trim();
  const options = input.options.map((o) => o.replace(/\s+/g, " ").trim()).filter(Boolean);
  const requirements = input.requirements.map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean);
  // Checked before anything is created, so invalid files never leave a project behind.
  if (input.files?.length) buildClientFileDocument(input.files);
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

  // A refused request (instructions among the requirements, document limits …) must not leave a project with stored
  // files behind (ChatGPT review 08.11.26): it is archived before the error goes back to the client.
  try {
    // Files first: the requirement list is confirmed against the brief AND the documents (source hash). As a context
    // document they are read by the models but never become requirement candidates.
    const files = input.files?.length ? await addClientFileContext(db, ctx, project.id, { client: "mcp", files: input.files }) : null;

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
      items: confirmed.map((i) => ({ text: i.text, candidateKey: i.candidateKey, splitFrom: i.splitFrom ?? null })),
      excluded: [
        ...proposal.excluded.map((e) => ({ candidateKey: e.candidateKey, reason: e.reason })),
        ...fromContext.map((i) => ({ candidateKey: i.candidateKey!, reason: CLIENT_CONTEXT_EXCLUSION_REASON })),
      ],
      noHardRequirements: confirmed.length === 0,
    });
    await recordAudit(db, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: `${via}.decision_requested`,
      targetType: "project",
      targetId: project.id,
      metadata: { requirements: confirmed.length, options: options.length, files: files?.paths.length ?? 0, confirmedVia: via },
    });
    return { project, requirements: confirmed.map((i) => i.text), files: files?.paths ?? [] };
  } catch (error) {
    await archiveProject(db, ctx, project.id).catch(() => {});
    throw error;
  }
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

/** How a council was started outside the web app (#429): MCP client, Telegram bot or REST API with an API token. */
export type ClientChannel = "mcp" | "telegram" | "api";

/**
 * Marks a council as started by a client (#429), as an audit event – no schema change. Only councils marked this way
 * count against the daily client budget; the web app is never limited by it.
 */
export async function recordClientCouncilStart(db: Database, ctx: ActorContext, sessionId: string, via: ClientChannel) {
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "client.council_started", targetType: "council_session", targetId: sessionId, metadata: { via } });
}

/**
 * Daily token budget for councils started by an external client (#405): what this user's **client-started** councils
 * (MCP, Telegram, API token – `recordClientCouncilStart`) of the last 24 hours really used – plus the full budget of
 * those still running and of the new one – may not exceed `limit`. Councils started in the web app do not count.
 *
 * Live finding 08.11.26 (#429): the first version summed every council's *budget*. A finished council that reserved
 * 300k but used 150k counted 300k, so a normal day of councils hit the 5M limit while far less had been spent. Finished
 * councils now count their recorded usage (`tokens_used`); only queued or running ones count their whole budget. A prompt-injected IDE agent can then burn at most one day's budget of the
 * user's own keys, not five councils per minute around the clock.
 */
export async function assertClientDailyTokenBudget(db: Database, ctx: ActorContext, requested: number, limit: number, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(case when ${councilSession.status} in ('queued', 'running', 'cancel_requested') then ${councilSession.tokenBudget} else ${councilSession.tokensUsed} end), 0)`,
    })
    .from(councilSession)
    .where(
      and(
        eq(councilSession.organizationId, ctx.organizationId),
        eq(councilSession.createdById, ctx.userId),
        gte(councilSession.createdAt, since),
        inArray(
          councilSession.id,
          db
            .select({ id: auditEvent.targetId })
            .from(auditEvent)
            .where(and(eq(auditEvent.organizationId, ctx.organizationId), eq(auditEvent.action, "client.council_started"), gte(auditEvent.createdAt, since))),
        ),
      ),
    );
  const used = Number(row?.total ?? 0);
  if (used + requested > limit)
    throw new DomainError(
      "RATE_LIMITED",
      `Daily budget for councils started from a client reached: your client-started councils of the last 24 hours used ${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} tokens (running ones count with their full budget), and this one asks for ${requested.toLocaleString("en-US")}. Start it in the web app or wait.`,
    );
}
