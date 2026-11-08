import { SKILL_CATEGORIES } from "@consyrion/core";
import { listPublicSkills } from "@consyrion/db";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Select } from "@/components/ui/select";
import { getDb } from "@/lib/server/db";

/** Cached for five minutes: the catalog changes only when an admin publishes, hides or withdraws a skill. */
export const revalidate = 300;

export async function generateMetadata() {
  const t = await getTranslations("skillHub");
  return { title: t("catalog.metaTitle"), description: t("catalog.metaDescription") };
}

/** Public SkillHub catalog (#368 PR 6): reviewed community skills, no login needed. */
export default async function SkillCatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const { q, category } = await searchParams;
  const t = await getTranslations("skillHub");
  const tCategory = await getTranslations("skills.category");
  const skills = await listPublicSkills(await getDb(), { q, category });
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("catalog.title")}</h1>
      <p className="mt-2 text-muted">{t("catalog.intro")}</p>
      <form className="mt-6 flex flex-wrap gap-2" method="get" role="search">
        <label className="sr-only" htmlFor="skillhub-q">
          {t("catalog.search")}
        </label>
        <input
          id="skillhub-q"
          name="q"
          defaultValue={q ?? ""}
          maxLength={100}
          placeholder={t("catalog.search")}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
        <label className="sr-only" htmlFor="skillhub-category">
          {t("catalog.category")}
        </label>
        <Select id="skillhub-category" name="category" defaultValue={category ?? ""}>
          <option value="">{t("catalog.allCategories")}</option>
          {SKILL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tCategory(c)}
            </option>
          ))}
        </Select>
        <button type="submit" className="rounded-lg border border-line px-4 py-2 text-sm">
          {t("catalog.searchButton")}
        </button>
      </form>
      {skills.length === 0 ? (
        <p className="mt-8 text-sm text-muted">{q || category ? t("catalog.noResults") : t("catalog.empty")}</p>
      ) : (
        <ul className="mt-6 grid gap-3 md:grid-cols-2">
          {skills.map((s) => (
            <li key={`${s.handle}/${s.slug}`} className="rounded-lg border border-line p-4">
              <Link href={`/skills/@${s.handle}/${s.slug}`} className="font-semibold hover:underline">
                {s.name}
              </Link>
              <p className="mt-1 text-xs text-muted">
                @{s.handle} · {tCategory(s.category)} · v{s.version}
              </p>
              <p className="mt-2 text-sm">{s.summary}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-10 text-xs text-muted">{t("disclaimer")}</p>
    </>
  );
}
