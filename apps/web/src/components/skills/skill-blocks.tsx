"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "../ui/button";
import { TextField } from "../ui/field";
import { Badge } from "../ui/surface";
import { countStatuses, type SkillBlockStatus } from "./skill-block-status";

/** `{gap}` placeholders of a block, in order (same rule as core's skillBlockGaps; kept here so no core logic reaches the browser). */
const gapsOf = (block: string) => [...block.matchAll(/\{([^{}]{1,40})\}/g)].map((m) => m[1]!.trim());
const fill = (block: string, values: string[]) => {
  let i = 0;
  return block.replace(/\{([^{}]{1,40})\}/g, (whole) => values[i++]?.trim() || whole);
};

const TONE: Record<SkillBlockStatus, "success" | "warning" | "neutral"> = { adopted: "success", open: "warning", dismissed: "neutral" };

function StatusBadge({ status }: { status: SkillBlockStatus }) {
  const t = useTranslations("skills.intake");
  return <Badge tone={TONE[status]}>{t(`status.${status}`)}</Badge>;
}

/**
 * Requirement building blocks of the chosen skill (#363) in the requirement intake. They are proposals only: the user
 * fills the gaps and adds a block; nothing becomes a hard requirement until the list is confirmed as usual. Each block
 * shows its status (#420): adopted (a requirement matches it), open, or consciously dismissed.
 */
export function SkillBlocks({
  skillName,
  blocks,
  statuses,
  onAdd,
  onDismiss,
}: {
  skillName: string;
  blocks: string[];
  statuses?: SkillBlockStatus[];
  onAdd: (text: string) => void;
  onDismiss?: (block: string, dismissed: boolean) => void;
}) {
  const t = useTranslations("skills.intake");
  const [values, setValues] = useState<Record<number, string[]>>({});
  if (blocks.length === 0) return null;
  return (
    <div id="skill-blocks" role="region" aria-label={t("label", { name: skillName })} className="scroll-mt-6 rounded-xl border border-primary/30 p-3">
      <h3 className="text-sm font-medium">{t("title", { name: skillName })}</h3>
      <p className="mt-1 text-xs text-muted">{t("text")}</p>
      <ul className="mt-3 space-y-3">
        {blocks.map((block, index) => {
          const gaps = gapsOf(block);
          const current = values[index] ?? gaps.map(() => "");
          const missing = current.some((v) => !v.trim());
          const status = statuses?.[index] ?? "open";
          return (
            <li key={block} className="text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className={`min-w-0 whitespace-pre-wrap ${status === "dismissed" ? "text-muted line-through" : ""}`}>{fill(block, current)}</p>
                <StatusBadge status={status} />
              </div>
              {gaps.length && status === "open" ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {gaps.map((gap, g) => (
                    <TextField
                      key={`${gap}-${g}`}
                      label={gap}
                      value={current[g] ?? ""}
                      onChange={(e) => setValues((all) => ({ ...all, [index]: current.map((v, i) => (i === g ? e.target.value : v)) }))}
                    />
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {status === "open" ? (
                  <Button variant="secondary" disabled={missing} onClick={() => onAdd(fill(block, current))}>
                    {t("add")}
                  </Button>
                ) : null}
                {status === "adopted" ? (
                  <Button variant="secondary" disabled>
                    {t("added")}
                  </Button>
                ) : null}
                {onDismiss && status !== "adopted" ? (
                  <Button variant="ghost" onClick={() => onDismiss(block, status === "open")}>
                    {status === "open" ? t("dismiss") : t("reopen")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Always-visible line under the hard requirements (#420): how many blocks the skill proposes and how many are adopted,
 * open or dismissed, with "View blocks". With a confirmed list the blocks open read-only here; adding one means
 * editing the requirements – nothing is changed or confirmed from this summary.
 */
export function SkillBlocksSummary({
  skillName,
  blocks,
  statuses,
  editing,
  canWrite,
  onEdit,
  onDismiss,
}: {
  skillName: string;
  blocks: string[];
  statuses: SkillBlockStatus[];
  editing: boolean;
  canWrite: boolean;
  onEdit: () => void;
  onDismiss: (block: string, dismissed: boolean) => void;
}) {
  const t = useTranslations("skills.intake");
  const [open, setOpen] = useState(false);
  if (blocks.length === 0) return null;
  const counts = countStatuses(statuses);
  return (
    <div className="mt-3 scroll-mt-6 rounded-xl border border-primary/30 bg-surface-2 p-3 text-sm" id="skill-blocks-summary" data-testid="skill-blocks-summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0">
          {t("summary", { name: skillName, n: blocks.length, adopted: counts.adopted, open: counts.open })}
          {counts.dismissed ? ` ${t("summaryDismissed", { n: counts.dismissed })}` : ""}
        </p>
        {editing ? (
          <a href="#skill-blocks" className="text-primary hover:underline">
            {t("view")}
          </a>
        ) : (
          <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? t("hide") : t("view")}
          </Button>
        )}
      </div>
      {open && !editing ? (
        <div className="mt-3 space-y-2">
          <ul className="space-y-2">
            {blocks.map((block, index) => (
              <li key={block} className="flex flex-wrap items-start justify-between gap-2">
                <span className={`min-w-0 ${statuses[index] === "dismissed" ? "text-muted line-through" : ""}`}>{block}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={statuses[index] ?? "open"} />
                  {canWrite && statuses[index] !== "adopted" ? (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onDismiss(block, statuses[index] === "open")}>
                      {statuses[index] === "open" ? t("dismiss") : t("reopen")}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {canWrite && counts.open ? (
            <div>
              <p className="text-xs text-muted">{t("adoptHint")}</p>
              <Button variant="secondary" className="mt-2" onClick={onEdit}>
                {t("adoptEdit")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
