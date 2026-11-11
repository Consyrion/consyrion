import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, localeCookie, localeFromAcceptLanguage, MESSAGE_AREAS, type Locale } from "./locales";

/** Locale per request: the user's choice (cookie) first, otherwise the browser language; no locale in the URL. */
export default getRequestConfig(async () => {
  const chosen = localeCookie(await cookies());
  const locale = isLocale(chosen) ? chosen : localeFromAcceptLanguage((await headers()).get("accept-language"));
  const messages = await load(locale);
  const fallback = locale === DEFAULT_LOCALE ? messages : await load(DEFAULT_LOCALE);
  // Dates are shown in the operator's time zone until users can choose their own.
  return { locale, timeZone: "Europe/Zurich", messages: deepMerge(fallback, messages) };
});

/** The main file plus every area file of one locale, merged at the top level. */
async function load(locale: Locale): Promise<Record<string, unknown>> {
  const main = (await import(`../../messages/${locale}.json`)).default as Record<string, unknown>;
  const areas = await Promise.all(MESSAGE_AREAS.map(async (area) => (await import(`../../messages/${area}/${locale}.json`)).default as Record<string, unknown>));
  return Object.assign({}, main, ...areas);
}

/** Missing keys in a translation fall back to English instead of showing a key name. */
function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? deepMerge(base[k] as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
}
