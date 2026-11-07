import { useTranslations } from "next-intl";
import type { SessionViewJson } from "@/lib/types";

export type View = SessionViewJson;
export type ProposalJson = View["proposals"][number];

export interface ProposalContent {
  title: string;
  summary: string;
  architecture: string;
  components: string[];
  advantages: string[];
  disadvantages: string[];
  risks: Array<{ risk: string; severity: string; mitigation: string }>;
  costEstimate: string;
  assumptions: string[];
  recommendations: string[];
  confidence: number;
  /** Absent in proposals from before the feasibility check (#121). */
  solvesRequirements?: boolean;
  requirementConflicts?: string[];
}

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  google: "Gemini",
  deepseek: "DeepSeek",
  glm: "GLM",
  kimi: "Kimi",
  qwen: "Qwen",
  xai: "Grok",
};

export function latestRevision(p: ProposalJson) {
  return p.revisions[p.revisions.length - 1]!;
}

export function contentOf(p: ProposalJson, version?: number): ProposalContent {
  const revision = version ? (p.revisions.find((r) => r.version === version) ?? latestRevision(p)) : latestRevision(p);
  return revision.content as unknown as ProposalContent;
}

export function modelName(view: View, participantId: string | null | undefined) {
  const p = view.participants.find((x) => x.id === participantId);
  return p ? `${PROVIDER_LABELS[p.provider] ?? p.provider} · ${p.modelId}` : "Unknown model";
}

/** The stored formula names evaluators by participant id; shown with model names instead (#181 live test). */
export function readableFormula(view: View, formula: string) {
  return formula.replace(/"(par_[0-9a-f]+)"/g, (id, participantId: string) => {
    const p = view.participants.find((x) => x.id === participantId);
    return p ? `"${p.modelId}"` : id;
  });
}

export function proposalLabel(view: View, proposalId: string | null | undefined) {
  return view.proposals.find((p) => p.id === proposalId)?.label ?? "?";
}

export const roleLabel = (role: string | null | undefined) => (role ? role.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "");

/** Translated role name (`roleSuggestion.names.<role>`); unknown roles fall back to the English title case. */
export function useRoleLabel() {
  const t = useTranslations("roleSuggestion.names");
  return (role: string | null | undefined) => (role ? (t.has(role) ? t(role) : roleLabel(role)) : "");
}

/** Translated words for stored enum values (severity, objection status): the English value when no key exists. */
export function useEnumText(namespace: string) {
  const t = useTranslations(namespace as never) as unknown as { has: (key: string) => boolean; (key: string): string };
  return (value: string | null | undefined) => (value ? (t.has(value) ? t(value) : value.replaceAll("_", " ")) : "");
}

export const SEVERITY_TONE = { low: "neutral", medium: "warning", high: "danger", critical: "danger" } as const;
export const STATUS_TONE = { open: "warning", refuted: "success", resolved: "success", accepted: "danger", unresolved: "warning" } as const;

/**
 * The server states why a verdict is not approvable in English (packages/council/src/decision-format.ts). The known
 * sentences are shown in the interface language (QA 07.11.26: German UI, English reason); anything else stays as sent.
 */
const VERDICT_REASONS: ReadonlyArray<readonly [prefix: string, key: string]> = [
  ["Needs verification – the council could not confirm", "needsVerification"],
  ["This proposal does not meet every confirmed requirement", "notQualified"],
  ["Too few independent models checked this proposal", "limitedReview"],
  ["This verdict uses a result this version does not know", "unknownOutcome"],
];

export function useVerdictReason() {
  const t = useTranslations("verdictScreen.reasons");
  return (reason: string | null | undefined) => {
    if (!reason) return reason ?? null;
    const key = VERDICT_REASONS.find(([prefix]) => reason.startsWith(prefix))?.[1];
    return key ? t(key as never) : reason;
  };
}
