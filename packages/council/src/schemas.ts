import { z } from "zod";

const text = z.string();
const list = z.array(z.string());
const severity = z.enum(["low", "medium", "high", "critical"]);
const category = z.enum(["security", "functional", "performance", "cost", "maintainability", "other"]);
/** 0–10; models sometimes give half points (7.5) – accepted and rounded when stored. */
const score = z.number().min(0).max(10);

export const proposalContentSchema = z.object({
  title: text,
  summary: text,
  architecture: text,
  components: list,
  advantages: list,
  disadvantages: list,
  risks: z.array(z.object({ risk: text, severity, mitigation: text })),
  costEstimate: text,
  assumptions: list,
  recommendations: list,
  confidence: z.number().int().min(0).max(100),
  /**
   * False when the hard requirements of the brief cannot be met together and this proposal is a finding, not a
   * solution (#121). Kept separate from the quality of the analysis.
   */
  solvesRequirements: z.boolean(),
  /** The hard requirements that conflict; empty when the proposal solves them. */
  requirementConflicts: list,
});
export type ProposalContent = z.infer<typeof proposalContentSchema>;

export const openCouncilSchema = z.object({
  commonGround: list,
  keyDifferences: list,
  questions: z.array(z.object({ proposalLabel: text, question: text })),
});

export const answersSchema = z.object({
  answers: z.array(z.object({ questionId: text, answer: text })),
});

export const roleReviewSchema = z.object({
  reviews: z.array(
    z.object({
      proposalLabel: text,
      noSubstantiatedObjection: z.boolean(),
      critiques: z.array(
        z.object({
          // Defined since #169: models used to put either the attacked statement or their own objection here.
          claim: text.describe(
            "Your own objection in one sentence: what is wrong with the proposal and why it matters. Not a quote of the proposal's statement.",
          ),
          category,
          severity,
          evidence: text.describe("The reasoning or facts that support your objection; quote the criticised statement of the proposal here if needed."),
        }),
      ),
    }),
  ),
  preferredProposalLabel: text,
  preferenceReason: text,
});

export const rebuttalsSchema = z.object({
  rebuttals: z.array(z.object({ critiqueId: text, response: text, concedes: z.boolean() })),
});

export const objectionResponsesSchema = z.object({
  responses: z.array(z.object({ objectionId: text, response: text, evidence: text, concedes: z.boolean() })),
});

export const adjudicationSchema = z.object({
  verdicts: z.array(z.object({ objectionId: text, status: z.enum(["refuted", "resolved", "accepted", "unresolved"]), reason: text })),
});

export const revisionSchema = z.object({
  /** The core recommendation stays the same. Concrete corrections still belong in `content` (#94). */
  keepPosition: z.boolean(),
  reason: text,
  content: proposalContentSchema,
  changes: z.array(z.object({ change: text, motivatedBy: list })),
});

export const hybridSchema = z.object({
  shouldCreateHybrid: z.boolean(),
  rationale: text,
  sourceLabels: list,
  content: proposalContentSchema,
});

export const consensusSummarySchema = z.object({
  status: z.enum(["consensus", "partial", "no_consensus"]),
  agreements: list,
  disagreements: list,
  outstandingRisks: list,
});

const criterionScore = z.object({ score, rationale: text });
export const evaluationSchema = z.object({
  evaluations: z.array(
    z.object({
      proposalLabel: text,
      /** Copied from the proposal before scoring, so the score is bound to its content (#93). */
      proposalTitle: text,
      /** One sentence: what this proposal recommends. */
      proposalSummary: text,
      technicalQuality: criterionScore,
      security: criterionScore,
      maintainability: criterionScore,
      operatingCost: criterionScore,
      implementationSpeed: criterionScore,
      /** Independent feasibility check, separate from the scores (#121). */
      meetsRequirements: z.boolean(),
      requirementsNote: text,
    }),
  ),
  ranking: list,
});

/**
 * Final Verdict answer of gate version 2 (#181, S1): instead of one yes/no per proposal, one check per confirmed
 * requirement with status, the explicit statement that every part is met, and evidence.
 */
export const evaluationSchemaV2 = z.object({
  evaluations: z.array(
    z.object({
      proposalLabel: text,
      proposalTitle: text,
      proposalSummary: text,
      technicalQuality: criterionScore,
      security: criterionScore,
      maintainability: criterionScore,
      operatingCost: criterionScore,
      implementationSpeed: criterionScore,
      requirementChecks: z.array(
        z.object({
          requirementId: text.describe("Id of the confirmed requirement, e.g. R1"),
          status: z.enum(["PASS", "FAIL", "UNKNOWN"]),
          allPartsMet: z.boolean().describe("True only if every part of the requirement is met by the proposal as written"),
          evidence: text,
          /** Measured requirements ([estimate: …]) only: realistic range in the stated unit; null otherwise. */
          estimateLow: z.number().nullable().optional().describe("Requirements marked [estimate: …] only: the smaller number of the range (best realistic case; for availability the worst) in the stated unit; otherwise null"),
          estimateHigh: z.number().nullable().optional().describe("Requirements marked [estimate: …] only: the larger number of the range (worst realistic case; for availability the best) in the stated unit; otherwise null"),
        }),
      ),
    }),
  ),
  ranking: list,
});

const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "exclusiveMinimum",
  "exclusiveMaximum",
]);

/**
 * Converts a zod schema into the JSON Schema subset accepted by all three providers' structured
 * output modes: every object closed and fully required, no numeric/string constraints (zod still
 * enforces them when parsing the response).
 */
export function toProviderJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED_KEYWORDS.has(key)) continue;
      out[key] = strip(value);
    }
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties);
    }
    if (out.type === "integer") out.type = "number";
    return out;
  };
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}
