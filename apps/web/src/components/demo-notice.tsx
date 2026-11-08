import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonClasses } from "./ui/button";
import { Alert } from "./ui/surface";

/** Banner on the read-only demo project and its council (owner decision 08.11.26). */
export async function DemoNotice() {
  const t = await getTranslations("projects.demo");
  return (
    <div className="mb-6">
      <Alert tone="warning">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span>{t("notice")}</span>
          <Link href="/projects/new" className={buttonClasses("primary", "min-h-8 px-3 py-1")}>
            {t("cta")}
          </Link>
        </span>
      </Alert>
    </div>
  );
}
