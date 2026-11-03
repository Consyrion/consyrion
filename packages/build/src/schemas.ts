import { z } from "zod";

export const planSchema = z.object({
  summary: z.string(),
  stack: z.enum(["node", "python"]),
  installCommand: z.string(),
  testCommand: z.string(),
  tasks: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      description: z.string(),
      acceptanceCriteria: z.array(z.string()),
      dependsOn: z.array(z.string()),
    }),
  ),
});
export type PlanOutput = z.infer<typeof planSchema>;

export const fileChangesSchema = z.object({
  summary: z.string(),
  files: z.array(z.object({ path: z.string(), action: z.enum(["write", "delete"]), content: z.string() })),
});

export const reviewSchema = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  findings: z.array(z.object({ severity: z.enum(["low", "medium", "high", "critical"]), file: z.string(), issue: z.string(), suggestion: z.string() })),
});
