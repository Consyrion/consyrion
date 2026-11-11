import { proposalLabel, type View } from "./helpers";

/** One worded line of the process-quality card: what it measures, the figure, and its limit if any. */
export interface ProcessQualityLine {
  key: "participation" | "convergence" | "objections" | "weight";
  title: string;
  text: string;
  limit: string | null;
}

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * #182 / #268: the wording of `view.processQuality`, shared by the card and the PDF so both say exactly the same.
 * `t` is the `processQuality` namespace of the interface messages. Returns null when there is nothing stored.
 */
export function processQualityLines(view: View, t: T): ProcessQualityLine[] | null {
  const q = view.processQuality;
  if (!q) return null;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return [
    {
      key: "participation",
      title: t("participation.title"),
      text:
        q.participation && q.participation.percent !== null
          ? t("participation.value", {
              valid: q.participation.valid,
              total: q.participation.total,
              groupsValid: q.participationGroups?.valid ?? q.participation.valid,
              groups: q.participationGroups?.total ?? q.participation.total,
            })
          : t("notMeasurable"),
      limit: null,
    },
    {
      key: "convergence",
      title: t("convergence.title"),
      text: q.convergence.measurable
        ? t(`convergence.${q.convergence.level}`, { initial: pct(q.convergence.initial), latest: pct(q.convergence.latest) })
        : t(`convergence.${q.convergence.reason}`),
      limit: t("convergence.limit"),
    },
    {
      key: "objections",
      title: t("objections.title"),
      text:
        q.objections.total === 0
          ? t("objections.none")
          : t("objections.value", {
              total: q.objections.total,
              survived: q.objections.survived,
              refuted: q.objections.refuted,
              revised: q.objections.effects.revised,
              blocking: q.objections.effects.blocking,
              noEffect: q.objections.effects.none,
            }),
      limit: t("objections.limit"),
    },
    {
      key: "weight",
      title: t("weight.title"),
      text: !q.weight.measurable
        ? (q.weight as { reason?: string }).reason === "no_winner"
          ? t("weight.noWinner")
          : t("notMeasurable")
        : q.weight.changedWinner
          ? t("weight.changed", {
              share: pct(q.weight.topGroupShare),
              weighted: q.weight.weightedWinnerId ? proposalLabel(view, q.weight.weightedWinnerId) : "–",
              unweighted: q.weight.unweightedWinnerId ? proposalLabel(view, q.weight.unweightedWinnerId) : "–",
            })
          : t("weight.unchanged", { share: pct(q.weight.topGroupShare), groups: q.weight.groups }),
      limit: null,
    },
  ];
}
