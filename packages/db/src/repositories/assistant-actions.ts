import { assertCan, DomainError } from "@consyrion/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../client";
import { newId } from "../ids";
import { assistantChat, assistantMessage, type AssistantActionRecord } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { createProject, getProject, updateBrief } from "./projects";

/**
 * Suggested actions of the AI assistant (#283), like the OnJam assistant: the model proposes, the human clicks.
 *
 * - Only the types in ACTION_SCHEMAS exist. Anything else the model returns (approve, start a council or build,
 *   delete, billing, keys, settings, members …) is dropped when the answer is stored, and refused here if it ever
 *   reaches the execute step – the allowlist is the only gate, the model's wording never is.
 * - Nothing runs without the user's click. Running uses the signed-in user's actor and the normal repository functions,
 *   so permissions, validation and audit are the same as in the app's own forms.
 * - Writes are additive and reviewable: a project is created as a draft, a brief becomes a new version, proposed
 *   requirements land in the brief and stay unconfirmed until the user confirms the requirement list. Starting a
 *   council only opens its form; texts (customer summary, delivery message) are drafts the user copies.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const projectId = z.string().regex(/^prj_[\w]+$/, "Unknown project");
/**
 * Requirements text of a brief: one requirement per line. Models often send a list instead of one text (live test
 * 08.11.26, "Make it a council" – the card was dropped as invalid); a list is joined into "- " lines.
 */
const requirementsText = z
  .union([z.string(), z.array(z.string())])
  .transform((v) =>
    Array.isArray(v)
      ? v
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => (x.startsWith("- ") ? x : `- ${x}`))
          .join("\n")
      : v.trim(),
  )
  .pipe(z.string().max(20_000))
  .default("");

export const ACTION_SCHEMAS = {
  /** A new project saved as draft (not ready for a council). */
  create_project_draft: z.object({
    name: z.string().trim().min(2).max(120),
    type: z.enum(["idea", "architecture", "repository", "business", "technology_choice"]).default("idea"),
    idea: z.string().trim().min(20).max(20_000),
    goal: z.string().trim().max(5_000).default(""),
    requirements: requirementsText,
  }),
  /** A new brief version of an existing project (earlier versions stay). */
  draft_brief: z.object({
    projectId,
    idea: z.string().trim().min(20).max(20_000),
    goal: z.string().trim().max(5_000).default(""),
    requirements: requirementsText,
  }),
  /** Requirements added to the brief; they are unconfirmed until the user confirms the requirement list. */
  propose_requirements: z.object({ projectId, requirements: z.array(text(500)).min(1).max(20) }),
  /** Opens the council form of a project – the user checks the cost estimate and starts it themselves. */
  prepare_council: z.object({ projectId }),
  /** A summary text for a customer, to copy. */
  draft_customer_summary: z.object({
    sessionId: z
      .string()
      .regex(/^ses_[\w]+$/)
      .nullish(),
    text: text(6_000),
  }),
  /** A message for Slack, Teams or e-mail, to copy – never sent by the assistant. */
  prepare_delivery: z.object({ channel: z.enum(["slack", "teams", "email"]), subject: z.string().trim().max(200).default(""), text: text(6_000) }),
} as const;

export type { AssistantActionRecord };
export type AssistantActionType = keyof typeof ACTION_SCHEMAS;
export const ASSISTANT_ACTION_TYPES = Object.keys(ACTION_SCHEMAS) as AssistantActionType[];
export const MAX_ACTIONS_PER_ANSWER = 3;

const isAllowedType = (type: unknown): type is AssistantActionType => typeof type === "string" && Object.hasOwn(ACTION_SCHEMAS, type);

function parseParams(type: AssistantActionType, params: unknown) {
  const schema: z.ZodType = ACTION_SCHEMAS[type];
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid action parameters", z.flattenError(parsed.error));
  return parsed.data as Record<string, unknown>;
}

/**
 * Turns the model's raw suggestions into stored records. Unknown or forbidden types and invalid parameters are
 * dropped (counted in `rejected`), at most MAX_ACTIONS_PER_ANSWER remain.
 */
export function acceptActionProposals(raw: Array<{ type: unknown; params: unknown; summary: unknown }>): {
  actions: AssistantActionRecord[];
  rejected: Array<{ type: string; reason: "not_allowed" | "invalid" }>;
} {
  const actions: AssistantActionRecord[] = [];
  const rejected: Array<{ type: string; reason: "not_allowed" | "invalid" }> = [];
  for (const item of raw) {
    const type = typeof item.type === "string" ? item.type.slice(0, 60) : "?";
    if (!isAllowedType(item.type)) {
      rejected.push({ type, reason: "not_allowed" });
      continue;
    }
    if (actions.length >= MAX_ACTIONS_PER_ANSWER) continue;
    try {
      const params = parseParams(item.type, item.params);
      const summary = typeof item.summary === "string" && item.summary.trim() ? item.summary.trim().slice(0, 300) : type;
      actions.push({ id: newId("aca"), type: item.type, summary, params, status: "proposed" });
    } catch {
      rejected.push({ type, reason: "invalid" });
    }
  }
  return { actions, rejected };
}

export interface ActionDecision {
  chatId: string;
  messageId: string;
  actionId: string;
  decision: "execute" | "dismiss";
  /** Parameters changed by the user ("Ändern"); validated like the model's. The type cannot change. */
  params?: unknown;
}

/** Runs or dismisses one suggested action – only on the user's click, with the user's permissions. */
export async function decideAssistantAction(db: Database, ctx: ActorContext, input: ActionDecision): Promise<AssistantActionRecord> {
  assertCan(ctx.role, "decision:run");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: assistantMessage.id, actions: assistantMessage.actions })
      .from(assistantMessage)
      .innerJoin(assistantChat, eq(assistantChat.id, assistantMessage.chatId))
      .where(
        and(
          eq(assistantMessage.id, input.messageId),
          eq(assistantMessage.chatId, input.chatId),
          eq(assistantChat.organizationId, ctx.organizationId),
          eq(assistantChat.userId, ctx.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "Chat not found");
    const actions = row.actions ?? [];
    const action = actions.find((a) => a.id === input.actionId);
    if (!action) throw new DomainError("NOT_FOUND", "Action not found");
    if (action.status !== "proposed")
      throw new DomainError("CONFLICT", action.status === "executed" ? "This action was already carried out" : "This action was dismissed");
    if (!isAllowedType(action.type)) throw new DomainError("FORBIDDEN", "The assistant cannot do this – only you can, in the app");

    let next: AssistantActionRecord;
    if (input.decision === "dismiss") {
      next = { ...action, status: "dismissed", decidedAt: new Date().toISOString() };
    } else {
      const edited = input.params !== undefined && JSON.stringify(input.params) !== JSON.stringify(action.params);
      const params = parseParams(action.type, edited ? input.params : action.params);
      const result = await runAction(tx, ctx, action.type, params);
      next = { ...action, params, status: "executed", decidedAt: new Date().toISOString(), edited, result };
    }
    await tx
      .update(assistantMessage)
      .set({ actions: actions.map((a) => (a.id === action.id ? next : a)) })
      .where(eq(assistantMessage.id, row.id));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.decision === "execute" ? "assistant.action_executed" : "assistant.action_dismissed",
      targetType: "assistant_chat",
      targetId: input.chatId,
      // "suggested by the AI assistant, confirmed by the user" – never the texts themselves (they may be long or private).
      metadata: {
        type: action.type,
        actionId: action.id,
        messageId: row.id,
        proposedBy: "ai_assistant",
        confirmedBy: ctx.userId,
        edited: next.edited ?? false,
        result: next.result?.href ?? null,
      },
    });
    return next;
  });
}

/**
 * Runs an allowlisted action directly for an external client (MCP, 06.11.26): the client's own tool approval is the
 * user's confirmation. Same allowlist, validation, permissions and audit as the assistant's cards.
 */
export async function runActionForClient(db: Database, ctx: ActorContext, type: string, params: unknown, source: "mcp") {
  if (!isAllowedType(type)) throw new DomainError("FORBIDDEN", "This action is not available");
  const parsed = parseParams(type, params);
  const result = await runAction(db, ctx, type, parsed);
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: `${source}.action_executed`,
    targetType: "workspace",
    targetId: ctx.organizationId,
    metadata: { type, result: result?.href ?? null },
  });
  return result;
}

async function runAction(db: Database, ctx: ActorContext, type: AssistantActionType, p: Record<string, unknown>): Promise<AssistantActionRecord["result"]> {
  switch (type) {
    case "create_project_draft": {
      const created = await createProject(db, ctx, {
        name: p.name as string,
        type: p.type as "idea",
        status: "draft",
        brief: { idea: p.idea as string, goal: p.goal as string, requirements: p.requirements as string },
      });
      return { label: created.name, href: `/projects/${created.id}` };
    }
    case "draft_brief": {
      const current = await getProject(db, ctx, p.projectId as string);
      // The repository link is not the assistant's to change: keep it.
      await updateBrief(db, ctx, current.id, {
        idea: p.idea as string,
        goal: p.goal as string,
        requirements: p.requirements as string,
        repositoryUrl: current.brief?.repositoryUrl ?? null,
      });
      return { label: current.name, href: `/projects/${current.id}` };
    }
    case "propose_requirements": {
      const current = await getProject(db, ctx, p.projectId as string);
      if (!current.brief) throw new DomainError("CONFLICT", "Project has no brief");
      const added = (p.requirements as string[]).map((r) => `- ${r.replace(/\s+/g, " ")}`).join("\n");
      const requirements = [current.brief.requirements.trim(), added].filter(Boolean).join("\n");
      await updateBrief(db, ctx, current.id, { idea: current.brief.idea, goal: current.brief.goal, requirements, repositoryUrl: current.brief.repositoryUrl });
      return { label: current.name, href: `/projects/${current.id}` };
    }
    case "prepare_council": {
      const current = await getProject(db, ctx, p.projectId as string);
      assertCan(ctx.role, "decision:run");
      return { label: current.name, href: `/projects/${current.id}/council/new` };
    }
    case "draft_customer_summary":
    case "prepare_delivery":
      // A text draft: the user copies it; nothing is sent or stored elsewhere.
      return null;
  }
}
