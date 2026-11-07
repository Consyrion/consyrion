import { useFormatter, useTranslations } from "next-intl";
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

/**
 * Night test R2-04 (08.11.26): the requirement gate's summary and causes come from the engine in English. The known
 * sentences are shown in the interface language; anything else (estimates, new wording) stays as sent.
 */
const GATE_SUMMARIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^None of the (other )?evaluated proposals meets all confirmed requirements according to these evaluations\.$/, "noneMeets"],
  [/^None of the (\d+) (other )?evaluated proposals could be confirmed against all requirements: .*$/, "noneConfirmed"],
  [/^(\d+) of (\d+) (other )?evaluated proposals miss a confirmed requirement according to these evaluations; (\d+) could not be confirmed .*$/, "someMiss"],
];
// "evaluators?" keeps the engine's own wording out of the browser bundle (scripts/check-client-bundle.mjs markers).
const GATE_CAUSES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(\S+) not met according to (\d+) of (\d+) evaluators \(model judgement\)\.$/, "notMet"],
  [/^(\S+) disputed: (\d+) of (\d+) evaluators confirm it, (\d+) found it not met\.$/, "disputed"],
  [/^(\S+) not confirmed: (\d+) of (\d+) evaluators? could not confirm it\.$/, "notConfirmed"],
  [/^(\S+) not confirmed: (\d+) of (\d+) evaluators? gave no valid answer\.$/, "noAnswer"],
];

/**
 * R3-02 (08.11.26): the cause of a measured requirement ("R3 not confirmed: estimates 99.9–99.97 % (median 99.9425),
 * limit at least 99.95 %; 1 of 2 evaluators' ranges reach across the limit (model estimates).") was English with
 * decimal points. Parsed into its parts and rebuilt in the interface language with local number format.
 */
const ESTIMATE_CAUSE =
  /^(\S+) (not met|disputed|not confirmed): estimates (-?[\d.]+)–(-?[\d.]+)( %| EUR per month| \S+) \(median (-?[\d.]+)\), limit (below|at most|above|at least) (-?[\d.]+)(?: %| EUR per month| \S+); (.+) \(model estimates\)\.$/;
const ESTIMATE_PARTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(\d+) of (\d+) evaluators expect the limit to be missed$/, "missed"],
  [/^(\d+) of (\d+) evaluators' ranges reach across the limit$/, "across"],
  [/^(\d+) of (\d+) evaluators gave no usable estimate$/, "noEstimate"],
  // "evaluators?" keeps the engine's own wording out of the browser bundle.
  [/^(\d+) of (\d+) evaluators? gave no valid answer$/, "noAnswer"],
];
const ESTIMATE_STATUS: Record<string, string> = { "not met": "notMet", disputed: "disputed", "not confirmed": "notConfirmed" };
const ESTIMATE_RELATION: Record<string, string> = { below: "below", "at most": "atMost", above: "above", "at least": "atLeast" };

export function useGateText() {
  const t = useTranslations("requirementGate.text");
  const te = useTranslations("requirementGate.estimate");
  const format = useFormatter();
  const num = (raw: string) => format.number(Number(raw), { maximumFractionDigits: 6 });
  const estimateCause = (text: string): string | null => {
    const m = ESTIMATE_CAUSE.exec(text);
    if (!m) return null;
    const parts = m[9]!.split("; ").map((part) => {
      for (const [re, key] of ESTIMATE_PARTS) {
        const p = re.exec(part);
        if (p) return te(`part.${key}` as never, { k: Number(p[1]), n: Number(p[2]) } as never);
      }
      return null;
    });
    if (parts.some((p) => p === null)) return null;
    const unit = m[5] === " %" ? " %" : m[5] === " EUR per month" ? te("eurPerMonth") : m[5]!;
    return te("cause", {
      id: m[1]!,
      status: te(`status.${ESTIMATE_STATUS[m[2]!]}` as never),
      low: num(m[3]!),
      high: num(m[4]!),
      median: num(m[6]!),
      relation: te(`relation.${ESTIMATE_RELATION[m[7]!]}` as never),
      limit: num(m[8]!),
      unit,
      parts: parts.join("; "),
    } as never);
  };
  const summary = (text: string | null | undefined) => {
    if (!text) return text ?? null;
    for (const [re, key] of GATE_SUMMARIES) {
      const m = re.exec(text);
      if (!m) continue;
      const other = text.includes(" other evaluated") ? "yes" : "no";
      if (key === "noneMeets") return t("noneMeets", { other });
      if (key === "noneConfirmed") return t("noneConfirmed", { n: Number(m[1]), other });
      return t("someMiss", { unmet: Number(m[1]), n: Number(m[2]), open: Number(m[4]), other });
    }
    return text;
  };
  const cause = (text: string) => {
    const estimate = estimateCause(text);
    if (estimate) return estimate;
    for (const [re, key] of GATE_CAUSES) {
      const m = re.exec(text);
      if (!m) continue;
      if (key === "disputed") return t("disputed", { id: m[1]!, pass: Number(m[2]), n: Number(m[3]), fail: Number(m[4]) });
      return t(key as "notMet", { id: m[1]!, k: Number(m[2]), n: Number(m[3]) });
    }
    return text;
  };
  return { summary, cause };
}

export function useVerdictReason() {
  const t = useTranslations("verdictScreen.reasons");
  return (reason: string | null | undefined) => {
    if (!reason) return reason ?? null;
    const key = VERDICT_REASONS.find(([prefix]) => reason.startsWith(prefix))?.[1];
    return key ? t(key as never) : reason;
  };
}
