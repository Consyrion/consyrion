import type { ConfidenceIssue } from "@consyrion/core";
import type { ReportLocale } from "./report-i18n";

/**
 * Engine sentences in the report language (ChatGPT review of two Telegram PDFs, 08.11.26: the German report still
 * printed "Proposal B scored higher but is blocked …", "Addressed by the author in v2.", "security_expert",
 * "Status: partial"). The web UI translates the same sentences (components/session/engine-text.tsx, messages
 * engineText); these are the same wordings for the report, which cannot import the web messages.
 * English is never rewritten: `describeConfidenceIssue` and the stored objection texts stay as the engine wrote them.
 */

type Lang = Exclude<ReportLocale, "en">;
type Values = Record<string, string | number>;
const fill = (template: string, values: Values) => template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
/** "one|other" plural pair, picked by `count`. */
const plural = (pair: string, count: number) => {
  const [one, other] = pair.split("|");
  return count === 1 ? one! : (other ?? one!);
};

const ISSUE: Record<Lang, Record<string, string>> = {
  de: {
    missing_evaluators: "Vorschlag {label} wurde von {evaluators} von {expected} erwarteten Bewertern bewertet",
    vote_disagrees: "Die Mehrheitsabstimmung bevorzugt Vorschlag {label}, nicht die höchste gewichtete Punktzahl",
    participant_failed: "{model} ist aus dem Council ausgefallen ({reason}); sein Vorschlag, seine Einwände und Bewertungen fehlen",
    unreviewed_objections:
      "{count} Einwand konnte von keinem unabhängigen Prüfer geprüft werden und bleibt offen|{count} Einwände konnten von keinem unabhängigen Prüfer geprüft werden und bleiben offen",
    single_evaluator: "Vorschlag {label} wurde nur von einem unabhängigen Bewerter bewertet (nur zwei aktive Modelle)",
    requirements_disputed: "{failed} von {total} unabhängigen Bewertern sehen bei Vorschlag {label} eine harte Anforderung verfehlt",
    insufficient_evaluators:
      "Nur {evaluators} von {expected} erwarteten Bewertern lieferten verwertbare Bewertungen – zu wenige für eine Council-Entscheidung; wiederhole die Bewertung",
    no_debate_contribution:
      "{model} hat keine Rollenprüfung zum 12 Minds Council beigetragen (alle Aufrufe fehlgeschlagen); seine Perspektiven fehlen in der Debatte, seine Stimme zählt im Final Verdict aber, wenn es bewertet hat",
    undefended_proposal:
      "Vorschlag {label} wurde nicht verteidigt – {reason}: {count} Einwand dagegen bleibt unbeantwortet, was nicht dasselbe ist wie unwidersprochene Kritik|Vorschlag {label} wurde nicht verteidigt – {reason}: {count} Einwände dagegen bleiben unbeantwortet, was nicht dasselbe ist wie unwidersprochene Kritik",
    phase_shortened: "{phase} wurde gekürzt, um das Token-Budget für das Final Verdict zu sichern; das Urteil beruht auf den bis dahin vorliegenden Fassungen",
    weighting_changed_winner_both:
      "Die Stimmgewichte haben entschieden: Mit gleichen Gewichten würde der Council Vorschlag {unweighted} empfehlen, gewichtet empfiehlt er Vorschlag {weighted}",
    weighting_changed_winner_unweighted: "Die Stimmgewichte haben entschieden: Mit gleichen Gewichten würde der Council Vorschlag {unweighted} empfehlen",
    weighting_changed_winner_tie:
      "Die Stimmgewichte haben entschieden: Mit gleichen Gewichten endete der Council unentschieden (gewichtet: Vorschlag {weighted})",
    weighting_changed_winner_none:
      "Die Stimmgewichte haben entschieden: Mit gleichen Gewichten würde der Council keinen Vorschlag empfehlen (gewichtet: Vorschlag {weighted})",
    conflict_of_interest:
      "Vorschlag {blocked} hat mehr Punkte, wird aber nur durch die Anforderungsprüfungen des Autors von Vorschlag {label} blockiert – eine Entscheidung zu eigenen Gunsten, daher keine automatische Empfehlung",
    evaluation_rejected:
      "{count} Bewerter hat bei Vorschlag {label} den Titel eines anderen Vorschlags wiedergegeben; seine Bewertung dafür wurde verworfen|{count} Bewerter haben bei Vorschlag {label} den Titel eines anderen Vorschlags wiedergegeben; ihre Bewertungen dafür wurden verworfen",
  },
  fr: {
    missing_evaluators: "La proposition {label} a été notée par {evaluators} des {expected} évaluateurs attendus",
    vote_disagrees: "Le vote majoritaire favorise la proposition {label}, pas le meilleur score pondéré",
    participant_failed: "{model} a quitté le council ({reason}) ; sa proposition, ses critiques et ses notes manquent",
    unreviewed_objections:
      "{count} objection n’a pu être vérifiée par aucun relecteur indépendant et reste ouverte|{count} objections n’ont pu être vérifiées par aucun relecteur indépendant et restent ouvertes",
    single_evaluator: "La proposition {label} a été notée par un seul évaluateur indépendant (seulement deux modèles actifs)",
    requirements_disputed: "{failed} des {total} évaluateurs indépendants estiment que la proposition {label} manque une exigence stricte",
    insufficient_evaluators:
      "Seuls {evaluators} des {expected} évaluateurs attendus ont fourni des notes exploitables – trop peu pour une décision du council ; répétez l’évaluation",
    no_debate_contribution:
      "{model} n’a fourni aucune revue de rôle au 12 Minds Council (tous les appels ont échoué) ; ses perspectives manquent au débat, mais son vote compte dans le Final Verdict s’il a évalué",
    undefended_proposal:
      "La proposition {label} n’a pas été défendue – {reason} : {count} objection reste sans réponse, ce qui n’est pas une critique incontestée|La proposition {label} n’a pas été défendue – {reason} : {count} objections restent sans réponse, ce qui n’est pas une critique incontestée",
    phase_shortened:
      "{phase} a été raccourcie pour garder le budget de tokens pour le Final Verdict ; le verdict repose sur les révisions disponibles à ce moment",
    weighting_changed_winner_both:
      "Les poids de vote ont décidé : à poids égaux, le council recommanderait la proposition {unweighted} ; pondéré, il recommande la proposition {weighted}",
    weighting_changed_winner_unweighted: "Les poids de vote ont décidé : à poids égaux, le council recommanderait la proposition {unweighted}",
    weighting_changed_winner_tie: "Les poids de vote ont décidé : à poids égaux, le council finirait à égalité (pondéré : proposition {weighted})",
    weighting_changed_winner_none:
      "Les poids de vote ont décidé : à poids égaux, le council ne recommanderait aucune proposition (pondéré : proposition {weighted})",
    conflict_of_interest:
      "La proposition {blocked} a un meilleur score mais n’est bloquée que par les vérifications de l’auteur de la proposition {label} – une décision en sa propre faveur, donc pas de recommandation automatique",
    evaluation_rejected:
      "{count} évaluateur a repris le titre d’une autre proposition pour la proposition {label} ; sa note a été écartée|{count} évaluateurs ont repris le titre d’une autre proposition pour la proposition {label} ; leurs notes ont été écartées",
  },
  es: {
    missing_evaluators: "La propuesta {label} fue evaluada por {evaluators} de {expected} evaluadores esperados",
    vote_disagrees: "La votación por mayoría favorece la propuesta {label}, no la mayor puntuación ponderada",
    participant_failed: "{model} abandonó el council ({reason}); faltan su propuesta, sus críticas y sus puntuaciones",
    unreviewed_objections:
      "{count} objeción no pudo ser revisada por un revisor independiente y sigue abierta|{count} objeciones no pudieron ser revisadas por un revisor independiente y siguen abiertas",
    single_evaluator: "La propuesta {label} fue evaluada por un solo evaluador independiente (solo dos modelos activos)",
    requirements_disputed: "{failed} de {total} evaluadores independientes consideran que la propuesta {label} incumple un requisito estricto",
    insufficient_evaluators:
      "Solo {evaluators} de {expected} evaluadores esperados dieron puntuaciones utilizables – demasiado pocos para una decisión del council; repite la evaluación",
    no_debate_contribution:
      "{model} no aportó ninguna revisión de rol al 12 Minds Council (fallaron todas las llamadas); sus perspectivas faltan en el debate, pero su voto cuenta en el Final Verdict si evaluó",
    undefended_proposal:
      "La propuesta {label} no fue defendida – {reason}: {count} objeción sigue sin respuesta, lo que no equivale a una crítica no rebatida|La propuesta {label} no fue defendida – {reason}: {count} objeciones siguen sin respuesta, lo que no equivale a una crítica no rebatida",
    phase_shortened:
      "{phase} se acortó para reservar el presupuesto de tokens para el Final Verdict; el veredicto se basa en las revisiones disponibles en ese momento",
    weighting_changed_winner_both:
      "Los pesos de voto decidieron el resultado: con pesos iguales el council recomendaría la propuesta {unweighted}; con pesos recomienda la propuesta {weighted}",
    weighting_changed_winner_unweighted: "Los pesos de voto decidieron el resultado: con pesos iguales el council recomendaría la propuesta {unweighted}",
    weighting_changed_winner_tie:
      "Los pesos de voto decidieron el resultado: con pesos iguales el council terminaría en empate (con pesos: propuesta {weighted})",
    weighting_changed_winner_none:
      "Los pesos de voto decidieron el resultado: con pesos iguales el council no recomendaría ninguna propuesta (con pesos: propuesta {weighted})",
    conflict_of_interest:
      "La propuesta {blocked} obtuvo más puntos, pero solo la bloquean las comprobaciones del autor de la propuesta {label} – una decisión a su favor, por eso no hay recomendación automática",
    evaluation_rejected:
      "{count} evaluador repitió el título de otra propuesta para la propuesta {label}; se descartó su puntuación|{count} evaluadores repitieron el título de otra propuesta para la propuesta {label}; se descartaron sus puntuaciones",
  },
  zh: {
    missing_evaluators: "提案 {label} 由 {expected} 位预期评估者中的 {evaluators} 位评分",
    vote_disagrees: "多数投票支持提案 {label},而不是加权得分最高的提案",
    participant_failed: "{model} 已退出 council({reason});它的提案、异议和评分缺失",
    unreviewed_objections: "{count} 条异议无法由任何独立审查者审查,仍然未决|{count} 条异议无法由任何独立审查者审查,仍然未决",
    single_evaluator: "提案 {label} 只由一位独立评估者评分(只有两个活跃模型)",
    requirements_disputed: "{total} 位独立评估者中有 {failed} 位认为提案 {label} 未满足某项硬性需求",
    insufficient_evaluators: "{expected} 位预期评估者中只有 {evaluators} 位给出了可用评分 – 不足以做出 council 决定;请重复评估",
    no_debate_contribution:
      "{model} 没有为 12 Minds Council 提供任何角色审查(所有调用都失败);辩论中缺少它的视角,但如果它进行了评估,它在 Final Verdict 中的投票仍然计入",
    undefended_proposal:
      "提案 {label} 未得到辩护 – {reason}:针对它的 {count} 条异议仍未回答,这不等于无人反驳的批评|提案 {label} 未得到辩护 – {reason}:针对它的 {count} 条异议仍未回答,这不等于无人反驳的批评",
    phase_shortened: "{phase} 被缩短,以保证 Final Verdict 的 token 预算;裁决基于当时已有的版本",
    weighting_changed_winner_both: "投票权重起了决定作用:如果权重相同,council 会推荐提案 {unweighted},加权后推荐提案 {weighted}",
    weighting_changed_winner_unweighted: "投票权重起了决定作用:如果权重相同,council 会推荐提案 {unweighted}",
    weighting_changed_winner_tie: "投票权重起了决定作用:如果权重相同,council 会以平局结束(加权后:提案 {weighted})",
    weighting_changed_winner_none: "投票权重起了决定作用:如果权重相同,council 不会推荐任何提案(加权后:提案 {weighted})",
    conflict_of_interest: "提案 {blocked} 得分更高,但仅被提案 {label} 作者的需求检查所阻止 – 这是对自己有利的判断,因此没有自动推荐",
    evaluation_rejected:
      "{count} 位评估者在提案 {label} 中复述了另一个提案的标题;其对该提案的评分已被作废|{count} 位评估者在提案 {label} 中复述了另一个提案的标题;其对该提案的评分已被作废",
  },
};

/** Phase names are product names and stay English everywhere (CLAUDE.md, COUNCIL_PHASES). */
const phaseName = (phase: string) => phase.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * One confidence issue in the report language, with proposal ids already replaced by labels. `english` is the
 * engine's own sentence (describeConfidenceIssue) – returned unchanged for English and for issues without a template.
 */
export function confidenceIssueText(issue: ConfidenceIssue, locale: ReportLocale, english: string): string {
  if (locale === "en") return english;
  const d = ISSUE[locale];
  switch (issue.kind) {
    case "missing_evaluators":
      return fill(d.missing_evaluators!, { label: issue.proposalId, evaluators: issue.evaluators, expected: issue.expected });
    case "vote_disagrees":
      return fill(d.vote_disagrees!, { label: issue.majorityVoteWinnerId });
    case "participant_failed":
      return fill(d.participant_failed!, { model: issue.modelId, reason: issue.reason });
    case "unreviewed_objections":
      return fill(plural(d.unreviewed_objections!, issue.count), { count: issue.count });
    case "single_evaluator":
      return fill(d.single_evaluator!, { label: issue.proposalId });
    case "requirements_disputed":
      return fill(d.requirements_disputed!, { label: issue.proposalId, failed: issue.failed, total: issue.total });
    case "insufficient_evaluators":
      return fill(d.insufficient_evaluators!, { evaluators: issue.evaluators, expected: issue.expected });
    case "no_debate_contribution":
      return fill(d.no_debate_contribution!, { model: issue.modelId });
    case "undefended_proposal":
      return fill(plural(d.undefended_proposal!, issue.count), { label: issue.proposalId, reason: issue.reason, count: issue.count });
    case "phase_shortened":
      return fill(d.phase_shortened!, { phase: phaseName(issue.phase) });
    case "weighting_changed_winner":
      return issue.unweightedWinnerId
        ? fill(issue.weightedWinnerId ? d.weighting_changed_winner_both! : d.weighting_changed_winner_unweighted!, {
            unweighted: issue.unweightedWinnerId,
            weighted: issue.weightedWinnerId ?? "",
          })
        : fill(issue.unweightedOutcome === "tie" ? d.weighting_changed_winner_tie! : d.weighting_changed_winner_none!, {
            weighted: issue.weightedWinnerId ?? "–",
          });
    case "conflict_of_interest":
      return fill(d.conflict_of_interest!, { blocked: issue.blockedProposalId, label: issue.proposalId });
    case "evaluation_rejected":
      return fill(plural(d.evaluation_rejected!, issue.count), { label: issue.proposalId, count: issue.count });
    default:
      // comparison_incomplete carries a free engine note; it goes through the stored-sentence translation instead.
      return english;
  }
}

/** The fixed parts the council writes into an objection decision (packages/council/src/phases.ts). */
const OBJECTION: Record<Lang, Record<string, string>> = {
  de: {
    noJudgeFailed: "Kein unabhängiger Prüfer verfügbar – {reason} bei jedem infrage kommenden Richter",
    noJudge: "Kein unabhängiger Prüfer verfügbar",
    partialReviews: "({got} von {needed} nötigen unabhängigen Prüfungen – kein weiterer Richter verfügbar)",
    conceded: "Vom Autor zugestanden – als angenommen festgehalten, bis eine Überarbeitung es behebt (Prüfer: {said}).",
    changedAfterConcede: "Inhalt nach dem Zugeständnis in {versions} geändert (nicht mit diesem Einwand verknüpft).",
    addressed: "Vom Autor in {versions} überarbeitet.",
    notReReviewed: "Die Überarbeitung wurde noch nicht unabhängig nachgeprüft.",
    unresolved: "ungeklärt",
    refuted: "widerlegt",
    resolved: "behoben",
    accepted: "angenommen",
  },
  fr: {
    noJudgeFailed: "Aucun relecteur indépendant disponible – {reason} pour chaque juge éligible",
    noJudge: "Aucun relecteur indépendant disponible",
    partialReviews: "({got} sur {needed} relectures indépendantes requises – aucun autre juge disponible)",
    conceded: "Concédé par l’auteur – retenu comme accepté jusqu’à ce qu’une révision le corrige (relecteur : {said}).",
    changedAfterConcede: "Contenu modifié après la concession en {versions} (sans lien avec cette objection).",
    addressed: "Révisé par l’auteur en {versions}.",
    notReReviewed: "La révision n’a pas encore été relue de manière indépendante.",
    unresolved: "non tranché",
    refuted: "réfuté",
    resolved: "résolu",
    accepted: "accepté",
  },
  es: {
    noJudgeFailed: "No había ningún revisor independiente disponible – {reason} en cada juez elegible",
    noJudge: "No había ningún revisor independiente disponible",
    partialReviews: "({got} de {needed} revisiones independientes necesarias – no había más jueces disponibles)",
    conceded: "Concedido por el autor – registrado como aceptado hasta que una revisión lo corrija (revisor: {said}).",
    changedAfterConcede: "Contenido cambiado tras la concesión en {versions} (no vinculado a esta objeción).",
    addressed: "Revisado por el autor en {versions}.",
    notReReviewed: "La revisión aún no se ha comprobado de forma independiente.",
    unresolved: "sin resolver",
    refuted: "refutado",
    resolved: "resuelto",
    accepted: "aceptado",
  },
  zh: {
    noJudgeFailed: "没有可用的独立审查者 – 每位符合条件的评审都出现 {reason}",
    noJudge: "没有可用的独立审查者",
    partialReviews: "(所需 {needed} 次独立审查中完成了 {got} 次 – 没有其他评审可用)",
    conceded: "作者已承认 – 记录为成立,直到有修订解决它(审查者:{said})。",
    changedAfterConcede: "承认之后内容在 {versions} 中有变更(未与此异议关联)。",
    addressed: "作者已在 {versions} 中修订。",
    notReReviewed: "该修订尚未经过独立复核。",
    unresolved: "未解决",
    refuted: "已驳回",
    resolved: "已解决",
    accepted: "成立",
  },
};

const VERSIONS = String.raw`v\d+(?:, v\d+)*`;

/** Localizes the known fixed parts inside a stored objection decision; the reviewer's own words stay as written. */
export function objectionDecisionText(text: string, locale: ReportLocale): string {
  if (locale === "en") return text;
  const d = OBJECTION[locale];
  const said = (word: string) => d[word] ?? word;
  const rules: ReadonlyArray<readonly [RegExp, (m: string[]) => string]> = [
    [/No independent reviewer was available – (.+?) for every eligible judge/g, (m) => fill(d.noJudgeFailed!, { reason: m[1]! })],
    [/No independent reviewer was available/g, () => d.noJudge!],
    [/\((\d+) of (\d+) required independent reviews – no further judge was available\)/g, (m) => fill(d.partialReviews!, { got: m[1]!, needed: m[2]! })],
    [/Conceded by the author – recorded as accepted until a revision fixes it \(reviewer said: (\w+)\)\./g, (m) => fill(d.conceded!, { said: said(m[1]!) })],
    [
      new RegExp(String.raw`Content changed after the author conceded in (${VERSIONS}) \(not linked to this objection\)\.`, "g"),
      (m) => fill(d.changedAfterConcede!, { versions: m[1]! }),
    ],
    [new RegExp(String.raw`Addressed by the author in (${VERSIONS})\.`, "g"), (m) => fill(d.addressed!, { versions: m[1]! })],
    [/Not independently re-reviewed\./g, () => d.notReReviewed!],
  ];
  let out = text;
  for (const [pattern, replace] of rules) out = out.replace(pattern, (...args: unknown[]) => replace(args.slice(0, -2) as string[]));
  return out;
}
