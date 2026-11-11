import type { RoleProfileContent } from "@consyrium/core";
import { getTranslations } from "next-intl/server";

/**
 * Public view of an expert profile in the SkillHub (#368). Plain text only: sources are shown as named by the author,
 * their links as text – never as clickable links – so a profile cannot inject anything into the page. The
 * role-profile work stream may extend this view; the hub detail page renders it for `kind: "role_profile"`.
 */
export async function PublicRoleProfile({ content }: { content: RoleProfileContent }) {
  const t = await getTranslations("skillHub.profile");
  const tStatus = await getTranslations("roleProfiles.status");
  const section = (title: string, body: React.ReactNode) => (
    <section className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="mt-2 text-sm">{body}</div>
    </section>
  );
  return (
    <>
      {section(t("coreQuestion"), <p className="whitespace-pre-wrap break-words">{content.coreQuestion}</p>)}
      {content.lenses.length
        ? section(
            t("lenses"),
            <ul className="list-disc space-y-1 pl-5">
              {content.lenses.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>,
          )
        : null}
      {content.notSuitableFor ? section(t("notSuitableFor"), <p className="whitespace-pre-wrap break-words">{content.notSuitableFor}</p>) : null}
      {content.sources.length
        ? section(
            t("sources"),
            <>
              <p className="text-xs text-muted">{t("sourcesHint")}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {content.sources.map((s, i) => (
                  <li key={i} className="break-words">
                    <span className="mr-1 rounded border border-line px-1 text-xs text-muted">{t("statedByAuthor", { status: tStatus(s.status) })}</span>
                    {s.title}
                    {s.url ? <span className="block text-xs text-muted">{s.url}</span> : null}
                    {s.note ? <span className="block text-xs">{s.note}</span> : null}
                  </li>
                ))}
              </ul>
            </>,
          )
        : null}
      {/* Owner decision 08.11.26: someone else's text – what it can and cannot do in a council. */}
      <p className="mt-6 text-xs text-muted">{t("notice")}</p>
    </>
  );
}
