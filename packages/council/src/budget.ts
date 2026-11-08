import { finalVerdictCallItems, outputTokensFor } from "@consyrion/core";
import type { SessionContext } from "./context";
import { schema } from "@consyrion/db";
import { eq } from "drizzle-orm";
import { briefBlock } from "./prompts";

const CHARS_PER_TOKEN = 4;

/** Stage error of a phase that ended early because the budget was kept for the Final Verdict (#148). */
export const SHORTENED_FOR_BUDGET = "Shortened: the remaining token budget was kept for the Final Verdict";
/** System prompt, criteria and instructions of one Final Verdict call (measured ≈ 600 tokens; rounded up). */
const VERDICT_OVERHEAD_TOKENS = 1_500;

/**
 * Tokens the Final Verdict needs at most (#148): every active participant reserves its prompt (brief + all current
 * proposals) plus its full output limit, and these reservations are made in parallel. Earlier phases may only spend
 * the budget above this reserve, so a council that runs short still ends with a verdict. Before any proposal exists,
 * each proposal is assumed to be as long as a typical one (2,500 tokens, as in the cost preview).
 */
export async function verdictReserve(ctx: SessionContext): Promise<number> {
  const participants = await ctx.participants();
  const proposals = await ctx.proposals();
  const briefTokens = Math.ceil(briefBlock(await ctx.brief()).length / CHARS_PER_TOKEN);
  const proposalTokens =
    proposals.length > 0
      ? proposals.reduce((sum, p) => sum + Math.ceil(JSON.stringify(p.latest.content).length / CHARS_PER_TOKEN), 0)
      : participants.length * Math.min(ctx.policy.maxOutputTokens, 2_500);
  const input = briefTokens + proposalTokens + VERDICT_OVERHEAD_TOKENS;
  // Each evaluator scores every proposal but its own; the scorecard limit grows with them (#172). With the S1 gate it
  // also checks every confirmed requirement per proposal, and the Final Verdict call sizes its output limit by that –
  // the reserve must use the same count, or the earlier phases leave too little and an evaluation is refused (#181).
  // A split evaluation (#246) sends the prompt once per call and reserves each call's own output.
  const scored = Math.max(1, proposals.length > 0 ? proposals.length - 1 : participants.length - 1);
  const calls = finalVerdictCallItems(scored, await requirementsPerProposal(ctx));
  return participants.reduce(
    (sum, p) =>
      sum +
      calls.reduce(
        (s, items, index) => s + input + outputTokensFor(p.provider, ctx.policy.maxOutputTokens, index === 0 ? "evaluation" : "evaluation_checks", items),
        0,
      ),
    0,
  );
}

/** Requirements each S1 evaluation checks per proposal (at least 1); 1 for councils without the S1 gate. */
async function requirementsPerProposal(ctx: SessionContext): Promise<number> {
  const listId = ctx.session.requirementListId;
  if (ctx.session.gateVersion < 2 || !listId) return 1;
  const [list] = await ctx.db.select({ items: schema.requirementList.items }).from(schema.requirementList).where(eq(schema.requirementList.id, listId));
  return Math.max(1, list?.items.length ?? 0);
}
