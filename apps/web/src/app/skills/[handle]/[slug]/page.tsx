import { getPublicSkill } from "@consyrium/db";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { RoleProfileContent, SkillContent } from "@consyrium/core";
import { PublicRoleProfile } from "@/components/role-profiles/public-role-profile";
import { PublicSkillActions } from "@/components/skills/public-skill-actions";
import { getDb } from "@/lib/server/db";

export const revalidate = 300;

type Params = { params: Promise<{ handle: string; slug: string }> };

async function load(params: Params["params"]) {
  const { handle, slug } = await params;
  return getPublicSkill(await getDb(), decodeURIComponent(handle), decodeURIComponent(slug));
}

export async function generateMetadata({ params }: Params) {
  const skill = await load(params);
  if (!skill) return {};
  return { title: `${skill.name} · @${skill.handle}`, description: skill.summary, robots: skill.listed ? undefined : { index: false } };
}

/**
 * One public skill (#368 PR 6). Every text is rendered as plain text – no links, no markup – so a skill cannot inject
 * anything into the page. Using it creates the reader's own copy after sign-in; reports go to the admin queue.
 */
export default async function PublicSkillPage({ params }: Params) {
  const skill = await load(params);
  if (!skill) notFound();
  const t = await getTranslations("skillHub");
  const tCategory = await getTranslations("skills.category");
  const tRoles = await getTranslations("roleSuggestion.names");
  const tCriteria = await getTranslations("skills.criteria");
  const format = await getFormatter();
  const isSkill = skill.kind === "skill";
  const c = (isSkill ? skill.content : {}) as SkillContent;
  const section = (title: string, body: React.ReactNode) => (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="mt-2 text-sm">{body}</div>
    </section>
  );
  return (
    <article>
      <p className="text-xs text-muted">
        {isSkill ? tCategory(skill.category) : `${t("kinds.role_profile")} · ${tRoles.has(skill.category) ? tRoles(skill.category) : skill.category}`} ·{" "}
        {skill.publisherName ? `${skill.publisherName} (@${skill.handle})` : `@${skill.handle}`}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">{skill.name}</h1>
      <p className="mt-2">{skill.summary}</p>
      <p className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-success/40 px-2 py-0.5 text-success">{t("detail.reviewed")}</span>
        <span className="rounded-full border border-line px-2 py-0.5">v{skill.version}</span>
        {skill.publishedAt ? (
          <span className="rounded-full border border-line px-2 py-0.5">{format.dateTime(skill.publishedAt, { dateStyle: "medium" })}</span>
        ) : null}
        <span className="rounded-full border border-line px-2 py-0.5">{skill.license}</span>
        <span className="rounded-full border border-line px-2 py-0.5">{t("detail.uses", { n: skill.uses ?? 0 })}</span>
      </p>
      <PublicSkillActions handle={skill.handle} slug={skill.slug} kind={isSkill ? "skill" : "role_profile"} />
      {!isSkill ? <PublicRoleProfile content={skill.content as RoleProfileContent} /> : null}
      {c.roles?.length ? section(t("detail.perspectives"), <p>{c.roles.map((r) => (tRoles.has(r) ? tRoles(r) : r)).join(", ")}</p>) : null}
      {c.requirementBlocks?.length
        ? section(
            t("detail.blocks"),
            <ul className="list-disc space-y-1 pl-5">
              {c.requirementBlocks.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>,
          )
        : null}
      {c.weights
        ? section(
            t("detail.weights"),
            <p>
              {Object.entries(c.weights)
                .map(([k, v]) => `${tCriteria.has(k) ? tCriteria(k) : k} ${v} %`)
                .join(" · ")}
            </p>,
          )
        : null}
      {c.sessionRules ? section(t("detail.rules"), <p className="whitespace-pre-wrap break-words">{c.sessionRules}</p>) : null}
      {c.knowledge ? section(t("detail.knowledge"), <p className="whitespace-pre-wrap break-words">{c.knowledge}</p>) : null}
      {skill.changelog ? section(t("detail.changelog"), <p className="whitespace-pre-wrap break-words">{skill.changelog}</p>) : null}
      {section(t("detail.hash"), <code className="break-all text-xs">{skill.contentHash}</code>)}
      <p className="mt-10 text-xs text-muted">{t("detail.licenseText", { license: skill.license, handle: skill.handle })}</p>
      <p className="mt-2 text-xs text-muted">{skill.handle === "consyrium" ? t("disclaimerOfficial") : t("disclaimer")}</p>
    </article>
  );
}
