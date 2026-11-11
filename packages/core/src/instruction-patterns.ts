import { despace, normalizeForScan, rot13, unleet } from "./text-normalize";

/**
 * Instruction and steering patterns shared by the save-time skill check (`scanSkillContent`, also used for expert
 * profiles) and the SkillHub publication scan (#363, #423). One place, so both checks always apply the same rules.
 */

/** Text that tries to steer the council's rules instead of describing the subject (#363 security rule 1). */
export const INSTRUCTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:ignore|disregard|forget)\b.{0,40}\b(?:previous|above|prior|all|system)\b.{0,20}\b(?:instructions?|rules?|prompts?)\b/i,
  /\b(?:ignoriere|vergiss|missachte)\b.{0,40}\b(?:vorherigen?|obigen?|alle|system)\b.{0,20}\b(?:anweisungen|regeln|prompts?)\b/i,
  /\bsystem\s*prompt\b/i,
  /\b(?:mark|treat|count|report|rate)\b.{0,40}\b(?:as\s+)?(?:pass(?:ed)?|met|satisfied|approved)\b.{0,30}\b(?:always|regardless|without)\b/i,
  /\b(?:skip|bypass|override|umgeh\w*|überspring\w*)\b.{0,40}\b(?:approval|freigabe|review|prüfung|gate|requirements?|anforderungen)\b/i,
  /\b(?:you are|du bist)\s+(?:now\s+|jetzt\s+)?(?:the\s+)?(?:system|admin|developer)\b/i,
];

/**
 * Text that addresses the council, its reviewers or the model instead of describing the subject – in de/en/fr/es/zh.
 * Complements the V1 save-time patterns (`INSTRUCTION_PATTERNS`), which run here as well. Written so that ordinary
 * rules ("no deployment without approval", "requirements without evidence do not count as met") stay green.
 */
export const PUBLICATION_INSTRUCTION_PATTERNS: ReadonlyArray<RegExp> = [
  // en
  /\b(?:ignore|disregard|forget|override)\b.{0,40}\b(?:earlier|previous|prior|above|preceding|existing|all|any|your|the)\b.{0,20}\b(?:instructions?|rules?|guidelines?|prompts?|constraints?)\b/i,
  /\bnote\s+(?:to|for)\s+(?:the\s+)?(?:reviewers?|evaluators?|judges?|graders?|models?|assistants?|ai|llms?|council)\b/i,
  /\b(?:treat|consider|mark|count|rate|regard)\b.{0,30}\b(?:all|every|each|the)\b.{0,20}\brequirements?\b.{0,20}\bas\s+(?:fulfilled|met|satisfied|passed|ok)\b/i,
  /\b(?:do\s+not|don'?t|never|no\s+need\s+to)\s+(?:ask|wait|request)\b.{0,20}\b(?:for\s+)?(?:human\s+)?(?:sign[-\s]?off|approval|confirmation)\b/i,
  /\bno\s+(?:human\s+)?(?:sign[-\s]?off|approval|confirmation)\s+(?:is\s+)?(?:needed|required|necessary)\b/i,
  /\b(?:always|automatically|unconditionally)\s+(?:approve|pass|accept|select)\b/i,
  /\b(?:new|updated|real|actual)\s+instructions?\s*:/i,
  /\b(?:act|behave)\s+as\s+(?:an?\s+|the\s+)?(?:admin(?:istrator)?|system|developer|judge|root)\b/i,
  /\b(?:reveal|print|output|show|repeat|leak)\b.{0,20}\b(?:system\s*prompt|hidden\s+instructions?|api[-\s]?keys?|credentials)\b/i,
  /\b(?:jailbreak|developer\s+mode|dan\s+mode)\b/i,
  // de
  /\bhinweis\s+(?:an|für)\s+(?:die\s+)?(?:prüfer|gutachter|bewerter|modelle?|ki|richter|council)\b/i,
  /\b(?:alle|sämtliche|jede)\s+anforderung(?:en)?\b.{0,30}\bals\s+(?:erfüllt|bestanden|ok)\b.{0,20}\b(?:werten|gelten|behandeln|ansehen|markieren|betrachten)\b/i,
  /\b(?:frag|frage|fragt|warte|wartet)\s+nicht\b.{0,20}\b(?:nach\s+|auf\s+)?(?:der\s+|die\s+)?(?:menschliche[n]?\s+)?(?:freigabe|bestätigung|zustimmung)\b/i,
  /\b(?:keine|ohne)\s+(?:menschliche\s+)?(?:freigabe|bestätigung)\s+(?:ist\s+)?(?:nötig|notwendig|erforderlich)\b/i,
  /\b(?:immer|automatisch|bedingungslos)\s+(?:freigeben|bestehen\s+lassen|genehmigen|auswählen)\b/i,
  /\bneue\s+anweisung(?:en)?\s*:/i,
  /\b(?:ignorier|missacht|vergiss|übergeh)\w*\b.{0,40}\b(?:regeln|anweisungen|vorgaben|richtlinien)\b/i,
  /\b(?:gib|zeig|nenn)\w*\b.{0,20}\b(?:system-?prompt|api-?schlüssel|api-?key|zugangsdaten)\b/i,
  // fr
  /\bignore[rz]?\b.{0,30}\b(?:les\s+)?(?:instructions|règles|consignes)\b/i,
  /\bnote\s+(?:aux|pour\s+les)\s+(?:évaluateurs|relecteurs|examinateurs|modèles|juges)\b/i,
  /\b(?:considère|considérez|considérer|traite[rz]?)\b.{0,30}\bexigences\b.{0,20}\bcomme\s+(?:remplies|satisfaites|validées)\b/i,
  /\bne\s+(?:demande|demandez|demandons)\s+pas\b.{0,20}\b(?:d['’])?(?:approbation|validation|accord)\b/i,
  // es
  /\bignora(?:r|d)?\b.{0,30}\b(?:las\s+)?(?:instrucciones|reglas|normas)\b/i,
  /\bnota\s+(?:para|a)\s+(?:los\s+)?(?:revisores|evaluadores|modelos|jueces)\b/i,
  /\b(?:trata|considera|tratar|considerar|marca)\b.{0,30}\brequisitos\b.{0,20}\bcomo\s+(?:cumplidos|satisfechos|aprobados)\b/i,
  /\bno\s+(?:pidas|solicites|pidan|esperes)\b.{0,20}\b(?:la\s+)?(?:aprobación|validación|confirmación)\b/i,
  // zh
  /(?:忽略|无视|忽视|不要理会).{0,8}(?:指令|规则|指示|提示词)/u,
  /(?:所有|全部)要求.{0,6}(?:视为|当作|算作|标记为).{0,4}(?:满足|通过|符合)/u,
  /(?:视为|当作|标记为)(?:已)?(?:满足|通过)/u,
  /(?:无需|不需要|不要请求|不要要求)(?:人工)?(?:审批|批准|确认|签字|签核)/u,
  /(?:致|给)(?:审核|评审|审查)(?:者|员|人员)/u,
  /系统提示/u,
];

/**
 * Steering in any wording (Gesamttest 3, session 0d, 08.11.2026): "rate everything as fulfilled", "all requirements count
 * as met", "always recommend proposal 1", "regardless of what the proposals say" – in de/en/fr/es/zh. Each pattern needs
 * a universal quantifier ("everything", "all", "every", "alles", "jede" …), "always" or "regardless", so ordinary rules
 * such as "rate a requirement as met only with evidence" stay allowed.
 */
export const STEERING_PATTERNS: ReadonlyArray<RegExp> = [
  // en
  /\b(?:rate|mark|treat|consider|score|count|evaluate|judge|assess|grade|flag)\w*\b.{0,40}\b(?:everything|all|each|every|any)\b.{0,40}\bas\s+(?:fulfilled|met|satisfied|passed|ok|okay|compliant|approved)\b/i,
  /\b(?:everything|all\s+(?:the\s+)?requirements?|every\s+requirement|each\s+requirement)\b.{0,20}\b(?:is|are|counts?|shall\s+count|should\s+count)\s+(?:as\s+)?(?:fulfilled|met|satisfied|passed|compliant)\b/i,
  /\balways\s+(?:recommend|choose|pick|prefer|select|rank\s+first|approve|favou?r)\b/i,
  /\bregardless\s+of\s+(?:what\s+)?(?:the\s+)?(?:proposals?|evidence|answers?|models?|reviewers?|facts?)\b/i,
  /\bno\s+matter\s+what\s+(?:the\s+)?(?:proposals?|evidence|models?|reviewers?)\b/i,
  // de
  /\b(?:bewerte|werte|markiere|behandle|betrachte|zähle|stufe|beurteile|kennzeichne|setze)\w*\b.{0,40}\b(?:alles|alle|jede[nrsm]?|sämtliche)\b.{0,40}\bals\s+(?:erfüllt|bestanden|ok|okay|konform|gegeben|freigegeben)/i,
  /\b(?:alles|alle\s+anforderungen|jede\s+anforderung|sämtliche\s+anforderungen)\b.{0,20}\b(?:gilt|gelten|ist|sind|zählt|zählen)\s+(?:als\s+)?(?:erfüllt|bestanden|konform)/i,
  /\b(?:empfiehl|empfehle|empfehlt|wähle|wählt|bevorzuge|bevorzugt)\w*\b.{0,20}\b(?:immer|stets|grundsätzlich|ausnahmslos)\b/i,
  /\b(?:immer|stets|grundsätzlich|ausnahmslos)\b.{0,20}\b(?:empfehlen|empfiehl|wählen|wähle|bevorzugen|bevorzuge|freigeben|zustimmen)\b/i,
  /\begal\s+(?:was|wie)\b.{0,40}\b(?:vorschläge?|modelle?|nachweise|belege|gutachter|prüfer|antworten|sagen|zeigen)\b/i,
  /\bunabhängig\s+davon,?\s+was\b.{0,40}\b(?:vorschläge?|modelle?|nachweise|belege)\b/i,
  // fr
  /\b(?:evalue|evaluez|note|notez|marque|marquez|considere|considerez|traite|traitez|compte|comptez)\w*\b.{0,40}\b(?:tout|toutes?|tous|chaque)\b.{0,40}\bcomme\s+(?:rempli|remplie|remplies|remplis|satisfait|satisfaites|valide|validee|validees|conforme|conformes)/i,
  /\b(?:tout|toutes\s+les\s+exigences|chaque\s+exigence)\b.{0,20}\b(?:est|sont|compte|comptent)\b.{0,10}\b(?:rempli|remplie|remplies|satisfait|satisfaites|conforme|conformes)/i,
  /\b(?:recommande|recommandez|choisis|choisissez|prefere|preferez)\b.{0,15}\btoujours\b/i,
  /\bquoi\s+qu['’]en\s+disent\b|\bpeu\s+importe\s+ce\s+que\s+disent\b/i,
  // es
  /\b(?:evalua|evalue|califica|marca|considera|trata|cuenta)\w*\b.{0,40}\b(?:todo|todos|todas|cada)\b.{0,40}\bcomo\s+(?:cumplid[oa]s?|satisfech[oa]s?|aprobad[oa]s?|conformes?)/i,
  /\b(?:todo|todos\s+los\s+requisitos|cada\s+requisito)\b.{0,20}\b(?:esta|estan|es|son|cuenta|cuentan|se\s+consideran?)\b.{0,10}\b(?:cumplid[oa]s?|satisfech[oa]s?)/i,
  /\b(?:recomienda|recomiende|elige|elija|prefiere|prefiera)\b.{0,15}\bsiempre\b|\bsiempre\s+(?:recomienda|elige|prefiere)\b/i,
  /\bsin\s+importar\s+lo\s+que\s+digan\b|\bdigan\s+lo\s+que\s+digan\b/i,
  // zh
  /(?:一律|全部|所有|都|均|统统).{0,6}(?:视为|当作|算作|评为|标记为|判定为|认定为)?(?:已)?(?:满足|通过|合格|符合)/u,
  /(?:始终|总是|一律|永远|无条件)(?:推荐|选择|选|优先|批准)/u,
  /(?:无论|不管|不论).{0,10}(?:方案|提案|证据|模型|评审).{0,6}(?:说|怎么|如何|什么)/u,
];

export const ALL_INSTRUCTION_PATTERNS: ReadonlyArray<RegExp> = [...INSTRUCTION_PATTERNS, ...PUBLICATION_INSTRUCTION_PATTERNS, ...STEERING_PATTERNS];

function firstMatch(patterns: ReadonlyArray<RegExp>, text: string): RegExpExecArray | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m;
  }
  return null;
}

/**
 * The first instruction or steering attempt in a text – plain, after Unicode normalization, in leetspeak, with spaced
 * letters or in ROT13 – or null. `variant` is the normalized text the match refers to.
 */
/** French/Spanish patterns are written without accents; this variant lets them match "évaluez", "evalúa" … */
const stripAccents = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC");

export function findInstruction(raw: string): { index: number; variant: string; disguised: boolean; rot13: boolean } | null {
  if (!raw.trim()) return null;
  const text = normalizeForScan(raw);
  const variants: Array<[string, boolean]> = [
    [text, false],
    [stripAccents(text), false],
    [unleet(text), true],
    [despace(text), true],
    [despace(unleet(text)), true],
  ];
  for (const [variant, disguised] of variants) {
    const m = firstMatch(ALL_INSTRUCTION_PATTERNS, variant);
    if (m) return { index: m.index, variant, disguised, rot13: false };
  }
  const rotated = rot13(text);
  const m = firstMatch(ALL_INSTRUCTION_PATTERNS, rotated);
  return m ? { index: m.index, variant: rotated, disguised: true, rot13: true } : null;
}
