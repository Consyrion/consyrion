import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * #206: what a deletion removes – and what it cannot. Shown next to the delete button of a project and of a workspace,
 * so nobody is promised "everything is gone": backups keep the data for their retention period, and copies outside
 * CONSYRIUM AI (GitHub, sent reports, exports) are out of reach. Matches docs/privacy-data-map.md.
 */
export function DeletionNotice({ scope }: { scope: "project" | "workspace" }) {
  const t = useTranslations("deletion");
  const items =
    scope === "project"
      ? ["removedProject", "auditProject", "running", "backups", "external"]
      : ["removedWorkspace", "auditWorkspace", "feedback", "running", "backups", "external"];
  return (
    <div className="mb-4 rounded-lg border border-glass-line bg-surface-2/60 px-4 py-3 text-sm">
      <p className="font-semibold">{t("title")}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        {items.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <p className="mt-2 text-muted">
        <Link className="underline hover:text-text" href="/datenschutz">
          {t("privacy")}
        </Link>
      </p>
    </div>
  );
}
