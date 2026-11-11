import { useTranslations } from "next-intl";
import { COUNCIL_PHASES, COUNCIL_PHASE_LABELS, type CouncilPhase } from "@consyrium/core/browser";

export type StepState = "pending" | "running" | "completed" | "failed" | "skipped";

const DOT: Record<StepState, string> = {
  pending: "border-line text-muted",
  running: "border-primary text-primary neon-ring",
  completed: "border-success/60 bg-success/15 text-success",
  failed: "border-danger/60 bg-danger/15 text-danger",
  skipped: "border-line text-muted opacity-60",
};

/**
 * Derives step states from a session's current phase and status. Phases before the current one are
 * completed; the current one is running, failed or – once the session waits for a human – completed.
 */
export function stepStatesFor(currentPhase: CouncilPhase | null, status: string): Record<CouncilPhase, StepState> {
  const states = Object.fromEntries(COUNCIL_PHASES.map((p) => [p, "pending"])) as Record<CouncilPhase, StepState>;
  if (!currentPhase) return states;
  const index = COUNCIL_PHASES.indexOf(currentPhase);
  COUNCIL_PHASES.forEach((phase, i) => {
    if (i < index) states[phase] = "completed";
  });
  if (status === "failed") states[currentPhase] = "failed";
  else if (status === "running" || status === "queued" || status === "cancel_requested") states[currentPhase] = "running";
  else if (status === "awaiting_approval" || status === "approved" || status === "rejected" || status === "changes_requested") states[currentPhase] = "completed";
  else if (status === "cancelled") states[currentPhase] = "skipped";
  return states;
}

/** The seven canonical phases as a horizontal (desktop) / wrapping (mobile) stepper. */
export function WorkflowStepper({ states, compact = false, label }: { states: Partial<Record<CouncilPhase, StepState>>; compact?: boolean; label?: string }) {
  const t = useTranslations("dashboard.stepper");
  return (
    <ol aria-label={label ?? t("label")} className={`flex flex-wrap items-center ${compact ? "gap-1.5" : "gap-2"}`}>
      {COUNCIL_PHASES.map((phase, index) => {
        const state = states[phase] ?? "pending";
        return (
          <li key={phase} className="flex items-center gap-1.5" data-state={state}>
            <span
              className={`grid shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${compact ? "size-6" : "size-7"} ${DOT[state]}`}
              aria-hidden="true"
            >
              {state === "completed" ? "✓" : index + 1}
            </span>
            <span className={compact ? "sr-only" : "text-xs text-muted"}>
              {COUNCIL_PHASE_LABELS[phase]}
              <span className="sr-only"> – {t(`state.${state}`)}</span>
            </span>
            {index < COUNCIL_PHASES.length - 1 ? <span aria-hidden="true" className={`h-px ${compact ? "w-2" : "w-4"} ${state === "completed" ? "bg-success/50" : "bg-line"}`} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
