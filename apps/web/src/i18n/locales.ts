/**
 * Interface languages (owner decision 05.11.26). The interface is translated once into fixed message files – no model
 * calls. The language the models write in is a separate, per-council setting. Adding a language = one messages file.
 */
export const LOCALES = ["en", "de", "fr", "es", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "consyrium-locale";
/** Cookie name before the rename to CONSYRIUM AI (11 Nov 2026): still read so nobody loses the chosen language; only the new one is written. */
export const LEGACY_LOCALE_COOKIE = "consyrion-locale";
/** The chosen language from the request cookies (new name first, then the former one). */
export function localeCookie(jar: { get(name: string): { value: string } | undefined }): string | undefined {
  return jar.get(LOCALE_COOKIE)?.value ?? jar.get(LEGACY_LOCALE_COOKIE)?.value;
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  zh: "中文",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/** Best supported language from an Accept-Language header ("de-CH,de;q=0.9,en;q=0.8" → "de"). */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { base: (tag ?? "").toLowerCase().split("-")[0] ?? "", q: q ? Number(q) : 1 };
    })
    .filter((x) => x.base && Number.isFinite(x.q))
    .sort((a, b) => b.q - a.q);
  return ranked.map((x) => x.base).find(isLocale) ?? DEFAULT_LOCALE;
}

/**
 * Translation areas: besides `messages/<locale>.json` (landing, story, verdict, scene) every area keeps its own files
 * `messages/<area>/<locale>.json`, so app parts can be translated independently. Top-level keys of an area file are
 * namespaces and must not clash with other files (checked in messages.test.ts).
 */
export const MESSAGE_AREAS = ["app", "session", "settings", "feedback"] as const;
export type MessageArea = (typeof MESSAGE_AREAS)[number];
