import { describe, expect, it } from "vitest";
import { createDatabase, ensurePersonalOrganization, schema } from "@consyrion/db";
import { eq } from "drizzle-orm";
import { reconcileTokens } from "../src/engine";

// Night test 07.11.26: reservations of calls a restart interrupted stayed in the counter (916,799 vs. 789,888 recorded).
describe("token counter reconciliation", () => {
  it("sets the counter to the recorded council usage, without Execution Council calls", async () => {
    const handle = createDatabase("memory://");
    await handle.migrate();
    try {
      await handle.db.insert(schema.user).values({ id: "u", name: "U", email: "u@example.test" });
      const org = await ensurePersonalOrganization(handle.db, "u", "U");
      const [project] = await handle.db
        .insert(schema.project)
        .values({ id: "prj_t", organizationId: org.id, name: "T", type: "idea", createdById: "u" } as never)
        .returning();
      const [brief] = await handle.db
        .insert(schema.projectBrief)
        .values({ id: "brf_t", organizationId: org.id, projectId: project!.id, version: 1, idea: "x", createdById: "u" } as never)
        .returning();
      await handle.db.insert(schema.councilSession).values({
        id: "ses_t",
        organizationId: org.id,
        projectId: project!.id,
        briefId: brief!.id,
        mode: "independent_expert",
        status: "running",
        tokenBudget: 100_000,
        tokensUsed: 50_000,
        policy: {},
        policyVersion: 1,
        createdById: "u",
      } as never);
      const row = (phase: string, input: number, output: number) => ({
        id: `use_${phase}_${input}`,
        organizationId: org.id,
        sessionId: "ses_t",
        phase,
        provider: "anthropic",
        modelId: "m",
        inputTokens: input,
        outputTokens: output,
        durationMs: 1,
        outcome: "ok",
      });
      await handle.db
        .insert(schema.usageRecord)
        .values([row("independent_thinking", 1000, 500), row("final_verdict", 2000, 300), row("execution_council", 9000, 9000)] as never);
      await reconcileTokens(handle.db, "ses_t");
      const [session] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, "ses_t"));
      expect(session!.tokensUsed).toBe(3800);
    } finally {
      await handle.close();
    }
  });
});
