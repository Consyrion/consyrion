import { INSTRUCTION_PATTERNS, SECRET_PATTERNS, SKILL_EMAIL_PATTERN, type SkillContent } from "./skills";

/**
 * SkillHub publication check, static part (#423, ADR docs/adr/0368-skillhub.md). Runs on every version a user submits
 * for public use, before any model sees it, and again whenever the rules change (`PUBLICATION_SCAN_RULES_VERSION`).
 *
 * Result is a traffic light per version:
 * - red: never publishable (secret, instruction to the council or its reviewers – also when hidden by Unicode tricks,
 *   leetspeak, spaced letters or an encoding –, executable content).
 * - yellow: needs a human look (links, markup, encoded blocks, invisible or mixed-script characters, phone/IBAN).
 * - green: nothing found. Green is a signal, not a guarantee: no scanner is complete, which is why the runtime rules
 *   stay independent of it (a skill never changes the gate, the review breadth, objections or the human approval).
 *
 * A later semantic (model) check may only make the light stricter; it can never turn red into yellow or green.
 */

/** 2: extreme verdict weights (bias signal, ChatGPT review 08.11.2026). */
export const PUBLICATION_SCAN_RULES_VERSION = 2;

export type SkillReviewLight = "green" | "yellow" | "red";
export type PublicationFindingKind = "secret" | "personal_data" | "instruction" | "encoded_content" | "obfuscation" | "link" | "markup" | "code" | "bias";

export interface PublicationFinding {
  kind: PublicationFindingKind;
  severity: Exclude<SkillReviewLight, "green">;
  /** Field path, e.g. `knowledge`, `requirementBlocks[2]`, `changelog`. */
  field: string;
  message: string;
  /** Short normalized excerpt for the moderator (never for secrets). Shown as plain text only. */
  excerpt?: string;
}

export interface PublicationScanResult {
  light: SkillReviewLight;
  findings: PublicationFinding[];
  rulesVersion: number;
}

// --- Normalization -------------------------------------------------------------------------------------------------

/** Characters that render as nothing (zero-width, bidi controls, soft hyphen, variation selectors, tag characters). */
const INVISIBLE =
  // eslint-disable-next-line no-misleading-character-class -- the class lists invisible/combining code points on purpose
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu;
/** Zero-width joiner is part of normal emoji sequences – stripped for scanning, but no obfuscation signal on its own. */
const SUSPICIOUS_INVISIBLE =
  // eslint-disable-next-line no-misleading-character-class -- the class lists invisible/combining code points on purpose
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}]/u;
/** Latin letters in fullwidth or mathematical styles – NFKC folds them, their presence is a signal. */
const STYLED_LATIN = /[\uFF21-\uFF3A\uFF41-\uFF5A\u{1D400}-\u{1D7FF}]/u;

/** Cyrillic and Greek letters that look like Latin ones. */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ї: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ӏ: "l",
  ԛ: "q",
  ԝ: "w",
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  У: "Y",
  Х: "X",
  І: "I",
  Ј: "J",
  Ѕ: "S",
  α: "a",
  ο: "o",
  ρ: "p",
  ν: "v",
  ι: "i",
  κ: "k",
  τ: "t",
  υ: "u",
  χ: "x",
  ε: "e",
  Α: "A",
  Β: "B",
  Ε: "E",
  Η: "H",
  Ι: "I",
  Κ: "K",
  Μ: "M",
  Ν: "N",
  Ο: "O",
  Ρ: "P",
  Τ: "T",
  Υ: "Y",
  Χ: "X",
  Ζ: "Z",
};
const HOMOGLYPH_CHARS = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "gu");
/** A word that mixes Latin with Cyrillic/Greek letters – normal text in either script never does. */
/** A word that mixes Latin with Cyrillic/Greek letters – normal text in either script never does. Checked per word (linear). */
const hasMixedScriptWord = (text: string) => text.split(/[^\p{L}]+/u).some((w) => /[A-Za-z]/.test(w) && /[\u0370-\u03FF\u0400-\u04FF]/.test(w));

/** NFKC, invisible characters removed, look-alike letters mapped to Latin, whitespace collapsed. */
export function normalizeForScan(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(HOMOGLYPH_CHARS, (c) => HOMOGLYPHS[c] ?? c)
    .replace(/\s+/g, " ")
    .trim();
}

const LEET: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "|": "i", "!": "i" };

/** Leetspeak base forms, only inside tokens that mix letters and leet characters – plain numbers stay as they are. */
function unleet(text: string): string {
  return text.replace(/\S+/g, (token) => (/[a-z]/i.test(token) && /[013457@$|!]/.test(token) ? token.replace(/[013457@$|!]/g, (c) => LEET[c] ?? c) : token));
}

/** "i g n o r e" / "i.g.n.o.r.e" / "i-g-n-o-r-e" → "ignore". */
function despace(text: string): string {
  return text.replace(/(?<![\p{L}])(?:\p{L}[\s.\-_*·]){3,}\p{L}(?![\p{L}])/gu, (run) => run.replace(/[\s.\-_*·]/g, ""));
}

function rot13(text: string): string {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// --- Encoded blocks ------------------------------------------------------------------------------------------------

function printableUtf8(bytes: Uint8Array): string | null {
  if (bytes.length < 8) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const printable = [...text].filter((c) => /[\p{L}\p{N}\p{P}\p{Zs}\n]/u.test(c)).length;
  return printable / [...text].length >= 0.9 && /\p{L}{2,}/u.test(text) ? text : null;
}

function fromBase64(block: string): string | null {
  try {
    const binary = atob(block.replace(/-/g, "+").replace(/_/g, "/"));
    return printableUtf8(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

const fromHex = (hex: string) => printableUtf8(Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16)));

/** Text hidden in Base64, hex, \x / \u escapes or percent-encoding, decoded so it can be scanned like plain text. */
export function decodeEmbedded(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9+/_-]{20,}={0,2}/g)) {
    const decoded = fromBase64(m[0]);
    if (decoded) out.push(decoded);
  }
  for (const m of text.matchAll(/\b(?:[0-9a-f]{2}){10,}\b/gi)) {
    const decoded = fromHex(m[0]);
    if (decoded) out.push(decoded);
  }
  for (const m of text.matchAll(/(?:\\x[0-9a-f]{2}){6,}/gi)) {
    const decoded = fromHex(m[0].replace(/\\x/gi, ""));
    if (decoded) out.push(decoded);
  }
  // Escapes are replaced in place, so text around them ("\u0049\u0067… all previous instructions") is read as one.
  if (/(?:\\u[0-9a-f]{4}){3,}/i.test(text)) out.push(text.replace(/\\u([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
  if ((text.match(/%[0-9a-f]{2}/gi) ?? []).length >= 2) {
    try {
      out.push(decodeURIComponent(text));
    } catch {
      // malformed escapes – nothing to decode
    }
  }
  return out;
}

/** Encodings inside encodings (Base64 of Base64, percent-encoded Base64 …) up to three levels deep (ChatGPT review). */
function decodeNested(text: string, depth = 3): string[] {
  const out: string[] = [];
  let layer = [text];
  for (let level = 0; level < depth && layer.length; level++) {
    layer = layer.flatMap((t) => decodeEmbedded(t)).filter((d) => !out.includes(d));
    out.push(...layer);
  }
  return out;
}

// --- Patterns ------------------------------------------------------------------------------------------------------

/**
 * Text that addresses the council, its reviewers or the model instead of describing the subject – in de/en/fr/es/zh.
 * Complements the V1 save-time patterns (`INSTRUCTION_PATTERNS`), which run here as well. Written so that ordinary
 * rules ("no deployment without approval", "requirements without evidence do not count as met") stay green.
 */
const PUBLICATION_INSTRUCTION_PATTERNS: ReadonlyArray<RegExp> = [
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
  /\b(?:werte|behandle|betrachte|markiere)\w*\b.{0,30}\banforderung(?:en)?\b.{0,20}\bals\s+(?:erfüllt|bestanden)\b/i,
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

const PHONE = /(?:\+|\b00)\d{1,3}[\s/-]?\(?\d{1,4}\)?(?:[\s/-]?\d{2,4}){2,4}\b/;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/;
const URL = /\bhttps?:\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/i;
const DANGEROUS_SCHEME = /\b(?:javascript|vbscript|data|file):/i;
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/i;
const ACTIVE_HTML = /<\s*(?:script|iframe|object|embed|style|form|svg)\b|\bon[a-z]+\s*=/i;
const MARKDOWN_LINK = /!?\[[^\]\n]{1,200}\]\([^)\s]{1,500}\)/;
/** A skill has no executable part – shell or code instructions are what the ClawHavoc malware skills used. */
const CODE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i,
  /\brm\s+-rf?\s+[~/]/i,
  /\bpowershell(?:\.exe)?\b[^\n]{0,80}-(?:enc|encodedcommand|e)\b/i,
  /\bchmod\s+\+x\b/i,
  /\b(?:eval|exec)\s*\(/i,
  /\bbase64\s+(?:-d|--decode)\b/i,
  /`{3}\s*(?:bash|sh|zsh|shell|powershell|ps1|cmd|bat)\b/i,
  /\b(?:xattr\s+-d\s+com\.apple\.quarantine|osascript\s+-e)\b/i,
];

// --- Scan ----------------------------------------------------------------------------------------------------------

const excerptAt = (text: string, index: number) => {
  const start = Math.max(0, index - 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, index + 50).trim()}${index + 50 < text.length ? "…" : ""}`;
};

function firstMatch(patterns: ReadonlyArray<RegExp>, text: string): RegExpExecArray | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m;
  }
  return null;
}

const ALL_INSTRUCTIONS = [...INSTRUCTION_PATTERNS, ...PUBLICATION_INSTRUCTION_PATTERNS];

function scanField(field: string, raw: string, findings: PublicationFinding[]): void {
  if (!raw.trim()) return;
  const add = (finding: Omit<PublicationFinding, "field">) => {
    if (!findings.some((f) => f.field === field && f.kind === finding.kind)) findings.push({ field, ...finding });
  };
  const text = normalizeForScan(raw);

  if (SUSPICIOUS_INVISIBLE.test(raw) || STYLED_LATIN.test(raw) || hasMixedScriptWord(raw.normalize("NFKC")))
    add({ kind: "obfuscation", severity: "yellow", message: "Contains invisible, styled or look-alike characters that hide what the text says." });

  // Instructions: plain, leetspeak, spaced letters, ROT13 – any hit is red.
  const variants: Array<[string, boolean]> = [
    [text, false],
    [unleet(text), true],
    [despace(text), true],
    [despace(unleet(text)), true],
  ];
  for (const [variant, disguised] of variants) {
    const m = firstMatch(ALL_INSTRUCTIONS, variant);
    if (m) {
      add({
        kind: "instruction",
        severity: "red",
        message: disguised
          ? "Contains a disguised instruction to the council, its reviewers or the models (e.g. leetspeak or spaced letters)."
          : "Contains an instruction to the council, its reviewers or the models (e.g. ignore rules, treat requirements as met, skip the approval).",
        excerpt: excerptAt(variant, m.index),
      });
      break;
    }
  }
  if (firstMatch(ALL_INSTRUCTIONS, rot13(text)))
    add({ kind: "encoded_content", severity: "red", message: "Contains an instruction to the council hidden with ROT13." });

  if (SECRET_PATTERNS.some((p) => p.test(text)))
    add({ kind: "secret", severity: "red", message: "Contains something that looks like a key, token or password." });
  if (SKILL_EMAIL_PATTERN.test(text))
    add({ kind: "personal_data", severity: "red", message: "Contains an e-mail address – public skills carry no personal contact data." });
  else if (PHONE.test(text) || IBAN.test(text))
    add({ kind: "personal_data", severity: "yellow", message: "Contains what looks like a phone number or bank account – check it is not personal data." });

  const code = firstMatch(CODE_PATTERNS, text);
  if (code || DANGEROUS_SCHEME.test(text) || ACTIVE_HTML.test(text))
    add({
      kind: "code",
      severity: "red",
      message: "Contains commands, scripts or active markup – a skill has no executable part.",
      excerpt: code ? excerptAt(text, code.index) : undefined,
    });
  else if (HTML_TAG.test(text) || MARKDOWN_LINK.test(text))
    add({ kind: "markup", severity: "yellow", message: "Contains HTML or Markdown links – public skills are shown as plain text." });
  const url = URL.exec(text);
  if (url) add({ kind: "link", severity: "yellow", message: "Contains a link – check where it leads.", excerpt: url[0].slice(0, 80) });

  const decoded = decodeNested(text).map(normalizeForScan);
  if (decoded.some((plain) => firstMatch(ALL_INSTRUCTIONS, plain) || SECRET_PATTERNS.some((p) => p.test(plain)) || firstMatch(CODE_PATTERNS, plain)))
    add({
      kind: "encoded_content",
      severity: "red",
      message: "Contains an encoded block (Base64, hex, escapes) that hides an instruction, a secret or a command.",
    });
  else if (decoded.length)
    add({ kind: "encoded_content", severity: "yellow", message: "Contains an encoded block (Base64, hex, escapes) – skills are plain text." });
}

/** The static publication check for one skill version (and its changelog). */
export function scanSkillForPublication(content: SkillContent, extra: { changelog?: string | null } = {}): PublicationScanResult {
  const findings: PublicationFinding[] = [];
  scanField("name", content.name, findings);
  scanField("summary", content.summary, findings);
  (content.requirementBlocks ?? []).forEach((block, i) => scanField(`requirementBlocks[${i}]`, block, findings));
  scanField("sessionRules", content.sessionRules ?? "", findings);
  scanField("knowledge", content.knowledge ?? "", findings);
  scanField("changelog", extra.changelog ?? "", findings);
  // A skill can bias decisions without any injection wording: extreme weights get a human look (yellow, never red).
  const extreme = Object.entries(content.weights ?? {}).filter(([, v]) => v > 60 || v === 0);
  if (extreme.length)
    findings.push({
      kind: "bias",
      severity: "yellow",
      field: "weights",
      message: `Extreme verdict weights (${extreme.map(([k, v]) => `${k} ${v} %`).join(", ")}) – check that the skill does not bias decisions.`,
    });
  const red = findings.filter((f) => f.severity === "red");
  const ordered = [...red, ...findings.filter((f) => f.severity === "yellow")];
  return { light: red.length ? "red" : findings.length ? "yellow" : "green", findings: ordered, rulesVersion: PUBLICATION_SCAN_RULES_VERSION };
}
