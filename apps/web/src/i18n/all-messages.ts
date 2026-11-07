import appDe from "../../messages/app/de.json";
import appEn from "../../messages/app/en.json";
import appEs from "../../messages/app/es.json";
import appFr from "../../messages/app/fr.json";
import appZh from "../../messages/app/zh.json";
import de from "../../messages/de.json";
import feedbackDe from "../../messages/feedback/de.json";
import feedbackEn from "../../messages/feedback/en.json";
import feedbackEs from "../../messages/feedback/es.json";
import feedbackFr from "../../messages/feedback/fr.json";
import feedbackZh from "../../messages/feedback/zh.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import sessionDe from "../../messages/session/de.json";
import sessionEn from "../../messages/session/en.json";
import sessionEs from "../../messages/session/es.json";
import sessionFr from "../../messages/session/fr.json";
import sessionZh from "../../messages/session/zh.json";
import settingsDe from "../../messages/settings/de.json";
import settingsEn from "../../messages/settings/en.json";
import settingsEs from "../../messages/settings/es.json";
import settingsFr from "../../messages/settings/fr.json";
import settingsZh from "../../messages/settings/zh.json";
import zh from "../../messages/zh.json";
import type { Locale, MessageArea } from "./locales";

type Messages = Record<string, unknown>;

/** Every message file, statically imported – for tests and tooling (the app loads them per request in request.ts). */
export const MESSAGE_FILES: Record<Locale, { main: Messages; areas: Record<MessageArea, Messages> }> = {
  en: { main: en, areas: { app: appEn, session: sessionEn, settings: settingsEn, feedback: feedbackEn } },
  de: { main: de, areas: { app: appDe, session: sessionDe, settings: settingsDe, feedback: feedbackDe } },
  fr: { main: fr, areas: { app: appFr, session: sessionFr, settings: settingsFr, feedback: feedbackFr } },
  es: { main: es, areas: { app: appEs, session: sessionEs, settings: settingsEs, feedback: feedbackEs } },
  zh: { main: zh, areas: { app: appZh, session: sessionZh, settings: settingsZh, feedback: feedbackZh } },
};

/** All messages of one locale merged like request.ts does (without the English fallback). Use in component tests. */
export function messagesFor(locale: Locale = "en"): Messages {
  const f = MESSAGE_FILES[locale];
  return Object.assign({}, f.main, ...Object.values(f.areas));
}
