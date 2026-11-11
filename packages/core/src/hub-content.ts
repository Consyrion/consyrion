import { roleProfileHubAdapter } from "./role-profile-hub";
import { scanPublicationFields, type PublicationScanResult } from "./skill-publication-scan";
import { skillContentHash, validateSkillContent, type SkillContent } from "./skills";

/**
 * SkillHub content types (#368, owner decision 08.11.2026: expert profiles are a publishable type of their own with the
 * same pipeline – scan, model review, admin approval, CC BY 4.0, reports, versions). The hub code is generic over
 * `kind`; each type plugs in one adapter. Skill adapter here, role profile adapter in `role-profile-hub.ts`.
 */
export const HUB_KINDS = ["skill", "role_profile"] as const;
export type HubKind = (typeof HUB_KINDS)[number];

export interface HubContentAdapter<C = unknown> {
  kind: HubKind;
  validate(input: unknown): { ok: true; content: C } | { ok: false; errors: string[] };
  /** Text fields for scan and model review, with stable paths, e.g. "lenses[2]", "sources[0].url". */
  fields(content: C): Array<{ field: string; text: string }>;
  /** Catalog/queue display. category: SkillCategory for skills, the CouncilRole for profiles. */
  display(content: C): { name: string; summary: string; category: string };
  /** Extra lines for the model-review prompt (e.g. role, number of sources); no free text of the author. */
  reviewMeta(content: C): string[];
  /** sha256 of the canonical JSON. */
  hash(content: C): string;
}

export const skillHubAdapter: HubContentAdapter<SkillContent> = {
  kind: "skill",
  validate(input) {
    const r = validateSkillContent(input);
    return r.ok ? { ok: true, content: r.content } : { ok: false, errors: r.errors };
  },
  fields: (c) => [
    { field: "name", text: c.name },
    { field: "summary", text: c.summary },
    ...(c.requirementBlocks ?? []).map((text, i) => ({ field: `requirementBlocks[${i}]`, text })),
    { field: "sessionRules", text: c.sessionRules ?? "" },
    { field: "knowledge", text: c.knowledge ?? "" },
  ],
  display: (c) => ({ name: c.name, summary: c.summary, category: c.category }),
  reviewMeta: (c) =>
    [
      `Category: ${c.category}`,
      c.roles?.length ? `Perspectives: ${c.roles.join(", ")}` : "",
      c.weights
        ? `Weights: ${Object.entries(c.weights)
            .map(([k, v]) => `${k} ${v} %`)
            .join(", ")}`
        : "",
    ].filter(Boolean),
  hash: (c) => skillContentHash(c),
};

const ADAPTERS: Record<HubKind, HubContentAdapter> = {
  skill: skillHubAdapter as HubContentAdapter,
  role_profile: roleProfileHubAdapter as HubContentAdapter,
};

export function hubAdapter(kind: HubKind): HubContentAdapter {
  const adapter = ADAPTERS[kind];
  if (!adapter) throw new Error(`Unknown hub kind: ${String(kind)}`);
  return adapter;
}

export const isHubKind = (value: unknown): value is HubKind => HUB_KINDS.includes(value as HubKind);

/** Validated content of any hub kind, or the errors. */
export function validateHubContent(kind: HubKind, input: unknown) {
  return hubAdapter(kind).validate(input);
}

/** The static publication scan for any hub kind (fields + changelog; the bias signal applies to skills only). */
export function scanHubContent(kind: HubKind, content: unknown, extra: { changelog?: string | null } = {}): PublicationScanResult {
  const fields = [...hubAdapter(kind).fields(content), { field: "changelog", text: extra.changelog ?? "" }];
  return scanPublicationFields(fields, { weights: kind === "skill" ? ((content as SkillContent).weights ?? null) : null });
}
