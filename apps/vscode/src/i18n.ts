/**
 * Wording of the extension in the VS Code display language (QA 07.11.26: German VS Code showed
 * "independent expert · awaiting approval"). Keys are the English texts; a missing translation stays English.
 * Phase and mode names are product names and stay as they are. No vscode import, so it is testable.
 */
export type T = (text: string, values?: Record<string, string | number>) => string;

type Dictionary = Record<string, string>;

const DE: Dictionary = {
  // Session and phase states
  queued: "in Warteschlange",
  running: "läuft",
  awaiting_approval: "wartet auf Freigabe",
  approved: "freigegeben",
  rejected: "abgelehnt",
  changes_requested: "Änderungen angefordert",
  cancel_requested: "wird abgebrochen",
  cancelled: "abgebrochen",
  failed: "fehlgeschlagen",
  completed: "abgeschlossen",
  skipped: "übersprungen",
  pending: "ausstehend",
  // Decision view
  Phases: "Phasen",
  Verdict: "Urteil",
  "No verdict yet.": "Noch kein Urteil.",
  "This verdict cannot be approved or built here.": "Dieses Urteil kann hier nicht freigegeben oder gebaut werden.",
  "Recommended solution": "Empfohlene Lösung",
  "Tie – choose in the web app": "Gleichstand – wähle in der Web-App",
  "No solution meets the requirements": "Keine Lösung erfüllt die Anforderungen",
  "Insufficient independent evidence": "Zu wenig unabhängige Belege",
  "Needs verification – the council could not confirm that a proposal meets every requirement. It cannot be approved or built.":
    "Prüfung nötig – der Council konnte nicht bestätigen, dass ein Vorschlag alle Anforderungen erfüllt. Er kann nicht freigegeben oder gebaut werden.",
  "Proposal {label}": "Vorschlag {label}",
  "Objections (Minority Review)": "Einwände (Minority Review)",
  "Objection against Proposal {label}": "Einwand gegen Vorschlag {label}",
  "objection open": "Einwand offen",
  "objection refuted": "Einwand widerlegt",
  "objection resolved": "Einwand ausgeräumt",
  "objection accepted": "Einwand bestätigt",
  "objection unresolved": "Einwand ungeklärt",
  "blocks approval": "blockiert die Freigabe",
  none: "keine",
  "Your decision": "Deine Entscheidung",
  "Comment or reason": "Kommentar oder Begründung",
  Approve: "Freigeben",
  "Not approvable here.": "Hier nicht freigebbar.",
  "More debate": "Weiter debattieren",
  "Request changes": "Änderungen anfordern",
  Reject: "Ablehnen",
  "Open report": "Bericht öffnen",
  "Open generated changes": "Erzeugte Änderungen öffnen",
  // Extension messages
  "Open decision": "Entscheidung öffnen",
  "CONSYRION AI decision": "CONSYRION-AI-Entscheidung",
  "Personal API token (CONSYRION AI → Settings → API tokens)": "Persönliches API-Token (CONSYRION AI → Einstellungen → API-Tokens)",
  "This is an integration token; VS Code needs a full-access token (cns_…)":
    "Das ist ein Integrations-Token; VS Code braucht ein Token mit vollem Zugriff (cns_…)",
  "Tokens start with cns_": "Tokens beginnen mit cns_",
  "connected.": "verbunden.",
  "sign-in failed": "Anmeldung fehlgeschlagen",
  "request failed": "Anfrage fehlgeschlagen",
  "action failed": "Aktion fehlgeschlagen",
  "could not load the decision": "Entscheidung konnte nicht geladen werden",
  'Record "{action}" for this decision?': "„{action}“ für diese Entscheidung speichern?",
  Yes: "Ja",
  "no Execution Council run for this decision yet.": "für diese Entscheidung gibt es noch keinen Execution-Council-Lauf.",
  "the run produced no changes.": "der Lauf hat keine Änderungen erzeugt.",
  "{n} changed file(s) · run {status}": "{n} geänderte Datei(en) · Lauf {status}",
  " · draft PR available": " · Entwurfs-PR vorhanden",
};

const FR: Dictionary = {
  queued: "en file d’attente",
  running: "en cours",
  awaiting_approval: "attend l’approbation",
  approved: "approuvée",
  rejected: "rejetée",
  changes_requested: "modifications demandées",
  cancelled: "annulée",
  failed: "échec",
  completed: "terminée",
  skipped: "ignorée",
  pending: "en attente",
  Phases: "Phases",
  Verdict: "Verdict",
  "No verdict yet.": "Pas encore de verdict.",
  "This verdict cannot be approved or built here.": "Ce verdict ne peut être ni approuvé ni construit ici.",
  "Recommended solution": "Solution recommandée",
  "Needs verification – the council could not confirm that a proposal meets every requirement. It cannot be approved or built.":
    "Vérification nécessaire – le conseil n’a pas pu confirmer qu’une proposition remplit toutes les exigences. Elle ne peut être ni approuvée ni construite.",
  "Proposal {label}": "Proposition {label}",
  "Objections (Minority Review)": "Objections (Minority Review)",
  "Objection against Proposal {label}": "Objection contre la proposition {label}",
  "objection open": "objection ouverte",
  "objection accepted": "objection acceptée",
  "objection refuted": "objection réfutée",
  "blocks approval": "bloque l’approbation",
  none: "aucune",
  "Your decision": "Ta décision",
  Approve: "Approuver",
  "Request changes": "Demander des modifications",
  Reject: "Rejeter",
  "Open report": "Ouvrir le rapport",
  "Open decision": "Ouvrir la décision",
  "connected.": "connecté.",
  Yes: "Oui",
};

const ES: Dictionary = {
  queued: "en cola",
  running: "en curso",
  awaiting_approval: "pendiente de aprobación",
  approved: "aprobada",
  rejected: "rechazada",
  changes_requested: "cambios solicitados",
  cancelled: "cancelada",
  failed: "fallida",
  completed: "completada",
  skipped: "omitida",
  pending: "pendiente",
  Phases: "Fases",
  Verdict: "Veredicto",
  "No verdict yet.": "Aún no hay veredicto.",
  "This verdict cannot be approved or built here.": "Este veredicto no se puede aprobar ni construir aquí.",
  "Recommended solution": "Solución recomendada",
  "Needs verification – the council could not confirm that a proposal meets every requirement. It cannot be approved or built.":
    "Requiere verificación: el consejo no pudo confirmar que una propuesta cumpla todos los requisitos. No se puede aprobar ni construir.",
  "Proposal {label}": "Propuesta {label}",
  "Objection against Proposal {label}": "Objeción contra la propuesta {label}",
  "objection open": "objeción abierta",
  "objection accepted": "objeción aceptada",
  "objection refuted": "objeción refutada",
  "blocks approval": "bloquea la aprobación",
  none: "ninguna",
  "Your decision": "Tu decisión",
  Approve: "Aprobar",
  "Request changes": "Solicitar cambios",
  Reject: "Rechazar",
  "Open report": "Abrir informe",
  "Open decision": "Abrir decisión",
  "connected.": "conectado.",
  Yes: "Sí",
};

const DICTIONARIES: Record<string, Dictionary> = { de: DE, fr: FR, es: ES };

/** Translator for a VS Code display language such as "de", "de-ch" or "en-us". */
export function translator(language: string | undefined): T {
  const dictionary = DICTIONARIES[(language ?? "en").toLowerCase().split("-")[0]!] ?? {};
  return (text, values) => {
    const template = dictionary[text] ?? text;
    return values ? template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match)) : template;
  };
}

/** A stored state such as "awaiting_approval" in the display language (English words without underscores otherwise). */
export const stateText = (t: T, state: string) => {
  const translated = t(state);
  return translated === state ? state.replaceAll("_", " ") : translated;
};
