/**
 * Why an author did not answer an objection, in the reader's language. The engine stores the reason as an English
 * sentence (`undefendedReason` in the council's phases); the German report of 11.11.26 printed it as written:
 * "NICHT VERTEIDIGT – the author's answer was unusable (schema)". Used by the report and the web UI alike.
 * English and unknown sentences stay as stored.
 */
type Lang = "de" | "fr" | "es" | "zh";

const SENTENCE: Record<Lang, { provider: string; cutOff: string; unusable: string; failed: string }> = {
  de: {
    provider: "Anbieterfehler ({kind})",
    cutOff: "die Antwort des Autors wurde am Ausgabelimit abgeschnitten",
    unusable: "die Antwort des Autors war nicht verwertbar ({kind})",
    failed: "der Aufruf des Autors ist fehlgeschlagen",
  },
  fr: {
    provider: "erreur du fournisseur ({kind})",
    cutOff: "la réponse de l’auteur a été coupée à la limite de sortie",
    unusable: "la réponse de l’auteur était inutilisable ({kind})",
    failed: "l’appel de l’auteur a échoué",
  },
  es: {
    provider: "error del proveedor ({kind})",
    cutOff: "la respuesta del autor se cortó en el límite de salida",
    unusable: "la respuesta del autor no era utilizable ({kind})",
    failed: "la llamada del autor falló",
  },
  zh: {
    provider: "提供方错误({kind})",
    cutOff: "作者的回答在输出上限处被截断",
    unusable: "作者的回答无法使用({kind})",
    failed: "作者的调用失败",
  },
};

/** The call error kinds as words; a kind without an entry is shown as stored. */
const KIND: Record<Lang, Record<string, string>> = {
  de: {
    timeout: "Zeitüberschreitung",
    "rate limit": "Anfragelimit erreicht",
    overloaded: "Anbieter überlastet",
    network: "Netzwerkfehler",
    auth: "Anmeldung beim Anbieter abgelehnt",
    "model not found": "Modell nicht gefunden",
    "bad request": "Anfrage abgelehnt",
    "provider error": "Fehler beim Anbieter",
    credential: "Zugangsschlüssel fehlt oder ist ungültig",
    schema: "nicht im erwarteten Format",
    mismatch: "passt nicht zur Aufgabe",
    refusal: "Antwort verweigert",
  },
  fr: {
    timeout: "délai dépassé",
    "rate limit": "limite de requêtes atteinte",
    overloaded: "fournisseur surchargé",
    network: "erreur réseau",
    auth: "authentification refusée par le fournisseur",
    "model not found": "modèle introuvable",
    "bad request": "requête refusée",
    "provider error": "erreur chez le fournisseur",
    credential: "clé d’accès manquante ou invalide",
    schema: "pas au format attendu",
    mismatch: "ne correspond pas à la tâche",
    refusal: "réponse refusée",
  },
  es: {
    timeout: "tiempo de espera agotado",
    "rate limit": "límite de solicitudes alcanzado",
    overloaded: "proveedor sobrecargado",
    network: "error de red",
    auth: "autenticación rechazada por el proveedor",
    "model not found": "modelo no encontrado",
    "bad request": "solicitud rechazada",
    "provider error": "error del proveedor",
    credential: "clave de acceso ausente o no válida",
    schema: "no tiene el formato esperado",
    mismatch: "no corresponde a la tarea",
    refusal: "respuesta rechazada",
  },
  zh: {
    timeout: "超时",
    "rate limit": "达到请求上限",
    overloaded: "提供方过载",
    network: "网络错误",
    auth: "提供方拒绝了身份验证",
    "model not found": "找不到模型",
    "bad request": "请求被拒绝",
    "provider error": "提供方出错",
    credential: "访问密钥缺失或无效",
    schema: "不符合预期格式",
    mismatch: "与任务不符",
    refusal: "拒绝回答",
  },
};

const isLang = (locale: string): locale is Lang => locale in SENTENCE;

export function undefendedReasonText(reason: string, locale: string): string {
  const lang = locale.slice(0, 2).toLowerCase();
  if (!isLang(lang)) return reason;
  const sentence = SENTENCE[lang];
  const kind = (value: string) => KIND[lang][value] ?? value;
  const provider = /^provider error \((.+)\)$/.exec(reason);
  if (provider) return sentence.provider.replace("{kind}", kind(provider[1]!));
  const unusable = /^the author's answer was unusable \((.+)\)$/.exec(reason);
  if (unusable) return sentence.unusable.replace("{kind}", kind(unusable[1]!));
  if (reason === "the author's answer was cut off at the output limit") return sentence.cutOff;
  if (reason === "the author's call failed") return sentence.failed;
  return reason;
}

/**
 * One call error kind in the reader's language, e.g. "schema" → "nicht im erwarteten Format" (QA 12.11.26: the Council
 * Room showed "zuletzt: schema"). Underscores read as spaces; unknown kinds and English stay as stored.
 */
export function callErrorKindText(kind: string, locale: string): string {
  const lang = locale.slice(0, 2).toLowerCase();
  const spaced = kind.replaceAll("_", " ");
  return isLang(lang) ? (KIND[lang][spaced] ?? KIND[lang][kind] ?? spaced) : spaced;
}
