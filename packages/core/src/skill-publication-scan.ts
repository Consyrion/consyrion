import { detectImpersonation } from "./impersonation";
import { ALL_INSTRUCTION_PATTERNS, findInstruction } from "./instruction-patterns";
import { SECRET_PATTERNS, SKILL_EMAIL_PATTERN, type SkillContent } from "./skills";
import { hasMixedScriptWord, normalizeForScan, STYLED_LATIN, SUSPICIOUS_INVISIBLE } from "./text-normalize";

export { normalizeForScan } from "./text-normalize";

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

/** 2: extreme verdict weights (bias signal). 3: multilingual steering patterns. 4: impersonation (yellow) – Gesamttest 3. */
export const PUBLICATION_SCAN_RULES_VERSION = 4;

export type SkillReviewLight = "green" | "yellow" | "red";
export type PublicationFindingKind =
  | "secret"
  | "personal_data"
  | "instruction"
  | "encoded_content"
  | "obfuscation"
  | "link"
  | "markup"
  | "code"
  | "bias"
  | "impersonation";

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

// --- Other patterns -----------------------------------------------------------------------------------------------

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

const ALL_INSTRUCTIONS = ALL_INSTRUCTION_PATTERNS;

function scanField(field: string, raw: string, findings: PublicationFinding[]): void {
  if (!raw.trim()) return;
  const add = (finding: Omit<PublicationFinding, "field">) => {
    if (!findings.some((f) => f.field === field && f.kind === finding.kind)) findings.push({ field, ...finding });
  };
  const text = normalizeForScan(raw);

  if (SUSPICIOUS_INVISIBLE.test(raw) || STYLED_LATIN.test(raw) || hasMixedScriptWord(raw.normalize("NFKC")))
    add({ kind: "obfuscation", severity: "yellow", message: "Contains invisible, styled or look-alike characters that hide what the text says." });

  // Instructions and steering: plain, leetspeak, spaced letters, ROT13 – any hit is red.
  const instruction = findInstruction(raw);
  if (instruction?.rot13) add({ kind: "encoded_content", severity: "red", message: "Contains an instruction to the council hidden with ROT13." });
  else if (instruction)
    add({
      kind: "instruction",
      severity: "red",
      message: instruction.disguised
        ? "Contains a disguised instruction to the council, its reviewers or the models (e.g. leetspeak or spaced letters)."
        : "Contains an instruction to the council, its reviewers or the models (e.g. ignore rules, treat requirements as met, skip the approval).",
      excerpt: excerptAt(instruction.variant, instruction.index),
    });

  // Impersonation of a real person ("think like <name>", "du bist <name>") – yellow: in a skill it can be a legitimate quote.
  const persona = detectImpersonation(raw);
  if (persona)
    add({
      kind: "impersonation",
      severity: "yellow",
      message: "Asks the models to act as a real person – check it is not impersonation.",
      excerpt: persona.slice(0, 80),
    });

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
/**
 * Generic publication scan over text fields (#368 hub kinds): every SkillHub type passes its fields through the same
 * rules. `weights` adds the bias signal for skills (extreme verdict weights are yellow, never red).
 */
export function scanPublicationFields(
  fields: ReadonlyArray<{ field: string; text: string }>,
  options: { weights?: Readonly<Partial<Record<string, number>>> | object | null } = {},
): PublicationScanResult {
  const findings: PublicationFinding[] = [];
  for (const f of fields) scanField(f.field, f.text, findings);
  const extreme = Object.entries((options.weights ?? {}) as Record<string, number>).filter(([, v]) => v > 60 || v === 0);
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

/** The static publication check for one skill version (and its changelog). */
export function scanSkillForPublication(content: SkillContent, extra: { changelog?: string | null } = {}): PublicationScanResult {
  return scanPublicationFields(
    [
      { field: "name", text: content.name },
      { field: "summary", text: content.summary },
      ...(content.requirementBlocks ?? []).map((text, i) => ({ field: `requirementBlocks[${i}]`, text })),
      { field: "sessionRules", text: content.sessionRules ?? "" },
      { field: "knowledge", text: content.knowledge ?? "" },
      { field: "changelog", text: extra.changelog ?? "" },
    ],
    { weights: content.weights ?? null },
  );
}
