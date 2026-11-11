/**
 * Text normalization shared by the save-time skill check and the SkillHub publication scan (#363/#423): invisible and
 * bidi characters, look-alike letters, leetspeak, spaced letters, ROT13. No imports, so every module can use it.
 */

/** Characters that render as nothing (zero-width, bidi controls, soft hyphen, variation selectors, tag characters). */
export const INVISIBLE =
  // eslint-disable-next-line no-misleading-character-class -- the class lists invisible/combining code points on purpose
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu;
/** Zero-width joiner is part of normal emoji sequences – stripped for scanning, but no obfuscation signal on its own. */
export const SUSPICIOUS_INVISIBLE =
  // eslint-disable-next-line no-misleading-character-class -- the class lists invisible/combining code points on purpose
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}]/u;
/** Latin letters in fullwidth or mathematical styles – NFKC folds them, their presence is a signal. */
export const STYLED_LATIN = /[\uFF21-\uFF3A\uFF41-\uFF5A\u{1D400}-\u{1D7FF}]/u;

/** Cyrillic and Greek letters that look like Latin ones. */
export const HOMOGLYPHS: Readonly<Record<string, string>> = {
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
export const HOMOGLYPH_CHARS = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "gu");
/** A word that mixes Latin with Cyrillic/Greek letters – normal text in either script never does. */
/** A word that mixes Latin with Cyrillic/Greek letters – normal text in either script never does. Checked per word (linear). */
export const hasMixedScriptWord = (text: string) => text.split(/[^\p{L}]+/u).some((w) => /[A-Za-z]/.test(w) && /[\u0370-\u03FF\u0400-\u04FF]/.test(w));

/** NFKC, invisible characters removed, look-alike letters mapped to Latin, whitespace collapsed. */
export function normalizeForScan(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(HOMOGLYPH_CHARS, (c) => HOMOGLYPHS[c] ?? c)
    .replace(/\s+/g, " ")
    .trim();
}

export const LEET: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "|": "i", "!": "i" };

/** Leetspeak base forms, only inside tokens that mix letters and leet characters – plain numbers stay as they are. */
export function unleet(text: string): string {
  return text.replace(/\S+/g, (token) => (/[a-z]/i.test(token) && /[013457@$|!]/.test(token) ? token.replace(/[013457@$|!]/g, (c) => LEET[c] ?? c) : token));
}

/** "i g n o r e" / "i.g.n.o.r.e" / "i-g-n-o-r-e" → "ignore". */
export function despace(text: string): string {
  return text.replace(/(?<![\p{L}])(?:\p{L}[\s.\-_*·]){3,}\p{L}(?![\p{L}])/gu, (run) => run.replace(/[\s.\-_*·]/g, ""));
}

export function rot13(text: string): string {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}
