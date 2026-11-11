import { roleProfileContentHash, validateRoleProfileContent, type RoleProfileContent } from "./role-profiles";
import type { HubContentAdapter } from "./hub-content";

/**
 * SkillHub adapter for role profiles (owner decision 08.11.26: a publishable kind of its own, per role, same pipeline as
 * skills). The content is the private profile's content, unchanged; publication only adds the hub's review on top.
 *
 * Security: every text field goes through the generic publication scan and the model review (`fields`), source links
 * are https only (a link is at least yellow in the scan), and "verified" stays the author's own claim – the public page
 * shows it as "stated by the author". At runtime a profile is untrusted `<role_profile>` data for its role only; the
 * schema has no field that could touch the gate, votes, weights, review breadth or the approval.
 */
export const roleProfileHubAdapter: HubContentAdapter<RoleProfileContent> = {
  kind: "role_profile",
  validate(input) {
    const result = validateRoleProfileContent(input);
    if (!result.ok) return { ok: false, errors: result.errors };
    // Unknown fields are never published silently.
    if (result.ignoredFields.length) return { ok: false, errors: [`Unknown fields: ${result.ignoredFields.join(", ")}`] };
    return { ok: true, content: result.content };
  },
  fields(content) {
    return [
      { field: "name", text: content.name },
      { field: "coreQuestion", text: content.coreQuestion },
      ...content.lenses.map((text, i) => ({ field: `lenses[${i}]`, text })),
      { field: "notSuitableFor", text: content.notSuitableFor },
      ...content.sources.flatMap((s, i) => [
        { field: `sources[${i}].title`, text: s.title },
        ...(s.url ? [{ field: `sources[${i}].url`, text: s.url }] : []),
        ...(s.note ? [{ field: `sources[${i}].note`, text: s.note }] : []),
      ]),
    ].filter((f) => f.text.trim().length > 0);
  },
  display(content) {
    return { name: content.name, summary: content.coreQuestion, category: content.role };
  },
  reviewMeta(content) {
    const statuses = content.sources.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
    return [
      `Kind: role profile for the 12 Minds role "${content.role}" (adds review lenses to that role only; it cannot change the gate, votes, weights or approval).`,
      `Lenses: ${content.lenses.length}; sources: ${content.sources.length}${
        content.sources.length
          ? ` (${Object.entries(statuses)
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")})`
          : ""
      }.`,
      `Source statuses are the author's own claims; "verified" is not checked by CONSYRIUM.`,
    ];
  },
  hash(content) {
    return roleProfileContentHash(content);
  },
};
