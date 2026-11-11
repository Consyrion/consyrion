import { COUNCIL_PHASES, COUNCIL_PHASE_LABELS } from "@consyrium/core";
import { useTranslations } from "next-intl";
import { Badge } from "./ui/surface";

/** Shows the seven canonical phases of a council session. */
export function PhaseOverview() {
  const t = useTranslations("projects");
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {COUNCIL_PHASES.map((phase, index) => (
        <li key={phase} className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{index + 1}</span>
          <span className="text-sm">{COUNCIL_PHASE_LABELS[phase]}</span>
        </li>
      ))}
      <li className="flex items-center rounded-lg px-3 py-2">
        <Badge tone="accent">{t("executionAfterApproval")}</Badge>
      </li>
    </ol>
  );
}
