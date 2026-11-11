/**
 * Impersonation check (0d's skills test 08.11.26, finding 7): a role profile must not tell a model to think, answer or
 * act like a real, named person ("Denke wie Elon Musk: …", "You are Warren Buffett"). The profile form already says
 * "no real names, no imitated personalities"; this enforces it. Shared with the SkillHub scan (c5), where it can be
 * graded yellow. Deterministic and multilingual (de, en, fr, es, zh); text is normalised first (zero-width, fullwidth).
 *
 * A "name" is two or three capitalised words ("Elon Musk", "Jeff Bezos", "Christine Lagarde") – roles and generic
 * phrases with an article ("wie ein Angreifer", "like a regulator", "du bist Sicherheitsexperte") are not names.
 */
const NAME = String.raw`(\p{Lu}[\p{Ll}'’.-]+(?:\s+(?:von|van|de|del|da|di|le|la|bin)?\s*\p{Lu}[\p{Ll}'’.-]+){1,2})`;

/** Case-insensitive only in the trigger words (a sentence may start with them); the name itself must be capitalised. */
const ci = (alternatives: string) =>
  alternatives
    .split("|")
    .map((phrase) =>
      // Every word of a trigger phrase: German capitalises nouns ("im Stil von"), sentences start upper case.
      phrase
        .split("\\s+")
        .map((w) => {
          const first = w.charAt(0);
          return first.toLowerCase() !== first.toUpperCase() ? `[${first.toUpperCase()}${first.toLowerCase()}]${w.slice(1)}` : w;
        })
        .join("\\s+"),
    )
    .join("|");
const rx = (source: string) => new RegExp(source, "u");

const TRIGGERS: ReadonlyArray<RegExp> = [
  // en
  rx(
    String.raw`\b(?:${ci("think|act|answer|respond|reply|write|speak|talk|reason|behave|decide|argue|review")})\s+(?:just\s+)?(?:like|as)\s+(?:if\s+you\s+were\s+)?${NAME}`,
  ),
  rx(String.raw`\b(?:${ci("you\\s+are|you're|pretend\\s+to\\s+be|pretend\\s+you\\s+are|imitate|impersonate|channel")})\s+${NAME}`),
  rx(String.raw`\b(?:${ci("in\\s+the\\s+style\\s+of|in\\s+the\\s+voice\\s+of|in\\s+the\\s+manner\\s+of")})\s+${NAME}`),
  rx(String.raw`\b(?:${ci("what")})\s+would\s+${NAME}\s+(?:do|say|think)`),
  // de
  rx(
    String.raw`\b(?:${ci("denke|denk|handle|handel|antworte|schreibe|schreib|sprich|argumentiere|entscheide|urteile|prüfe|bewerte|verhalte\\s+dich")})\s+(?:genau\s+)?(?:wie|als\s+wärst\s+du)\s+${NAME}`,
  ),
  rx(String.raw`\b(?:${ci("du\\s+bist|sie\\s+sind|spiele|spiel|imitiere|verkörpere|versetze\\s+dich\\s+in")})\s+${NAME}`),
  rx(String.raw`\b(?:${ci("im\\s+stil\\s+von|in\\s+der\\s+art\\s+von|nach\\s+art\\s+von")})\s+${NAME}`),
  rx(String.raw`\b(?:${ci("was")})\s+würde\s+${NAME}\s+(?:tun|sagen|denken)`),
  // fr
  rx(String.raw`\b(?:${ci("pense|agis|réponds|écris|parle|raisonne|décide")})\s+comme\s+${NAME}`),
  rx(String.raw`\b(?:${ci("tu\\s+es|vous\\s+êtes|incarne|imite")})\s+${NAME}`),
  rx(String.raw`(?:${ci("à\\s+la\\s+manière\\s+de")})\s+${NAME}`),
  // es
  rx(String.raw`\b(?:${ci("piensa|actúa|responde|escribe|habla|razona|decide")})\s+como\s+${NAME}`),
  rx(String.raw`\b(?:${ci("eres|usted\\s+es|imita|encarna")})\s+${NAME}`),
  rx(String.raw`\b(?:${ci("al\\s+estilo\\s+de")})\s+${NAME}`),
];

/** zh: "像马斯克一样思考", "你是巴菲特", "扮演…", "模仿…" – a role word is no name, so only verbs of imitation count. */
const ZH =
  /(?:像.{1,12}一样(?:思考|回答|行事|决策|说话)|你是[^\s，。,.]{2,8}(?:本人)?[，。,.\s]|扮演[^\s，。,.]{2,12}|模仿[^\s，。,.]{2,12}(?:的(?:风格|口吻|思维))?)/u;
/** zh role words after 你是/扮演 that are not persons. */
const ZH_ROLES = /(?:专家|分析师|工程师|架构师|顾问|评审|审查员|批评者|角色|视角)/u;

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(new RegExp("[\\u200B-\\u200D\\u2060\\uFEFF]", "g"), "")
    .replace(/\s+/g, " ");
}

/** The matched phrase when a text asks to imitate a named person, else null. */
export function detectImpersonation(text: string): string | null {
  const t = normalize(text);
  for (const re of TRIGGERS) {
    const m = re.exec(t);
    if (m) return m[0].trim();
  }
  const zh = ZH.exec(t);
  if (zh && !ZH_ROLES.test(zh[0])) return zh[0].trim();
  return null;
}
