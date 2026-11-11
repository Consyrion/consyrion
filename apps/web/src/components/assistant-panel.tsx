"use client";

import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { MIN_QUESTION_TOKENS } from "@/lib/assistant-estimate";
import { checkSummary, isSensitiveTopic, sameModelId, type CheckVerdict } from "@/lib/council-check";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { followSessionStatus } from "@/lib/session-status-stream";
import { Markdown } from "@/components/ui/markdown";
import { Select } from "@/components/ui/select";

/**
 * AI assistant panel (#279): a drawer on the right edge of every app page, opened from a vertical tab like the OnJam
 * mixer. Open/closed and the last tab are remembered per browser; on wide screens the page moves aside instead of
 * being covered; on phones the drawer takes the full width. ⌘/Ctrl+J toggles, Esc closes.
 * Answers come from the server (read-only tools on the user's own key); this component only shows them.
 */

type Tab = "chat" | "history" | "settings";
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  tools?: Array<{ name: string; args?: Record<string, unknown> }> | null;
  links?: Array<{ label: string; href: string }> | null;
  actions?: Action[] | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Approximate cost from the workspace's model prices (#281); null without a price for that model. */
  cost?: { amount: number; currency: string } | null;
  /** Second opinion (#281): the answer another model checked. */
  reviewOf?: string | null;
  createdAt?: string;
}
/** Cross-check of one answer by another model of the council chat (#241 stage 2). */
interface Check {
  id: string;
  messageId: string;
  model: string;
  verdict: CheckVerdict;
  reason: string;
}
/** Messages the model still reads in full; older ones need a summary (#280) – same as HISTORY_MESSAGES on the server. */
const HISTORY_MESSAGES = 20;
/** Assistant settings of the user (#281), stored on the server. */
interface Preference {
  credentialId: string | null;
  modelId: string | null;
  reviewerCredentialId: string | null;
  reviewerModelId: string | null;
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
}
interface Budget {
  today: number;
  thisMonth: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
}
/** A suggestion of the assistant (#283): nothing runs until the user clicks. */
interface Action {
  id: string;
  type: string;
  summary: string;
  params: Record<string, unknown>;
  status: "proposed" | "executed" | "dismissed";
  edited?: boolean;
  result?: { label: string; href: string } | null;
}
interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}
interface Credential {
  credentialId: string;
  provider: string;
  label: string;
  models: Array<{ modelId: string; displayName: string }>;
  error: string | null;
}

/** Event other components send to open the panel (#279), see `openAssistant` in assistant-open.ts. */
export const OPEN_ASSISTANT_EVENT = "consyrium:open-assistant";

const STORE_OPEN = "consyrium-assistant-open";
const STORE_TAB = "consyrium-assistant-tab";
const STORE_MODEL = "consyrium-assistant-model";
const STORE_CHAT_MODE = "consyrium-assistant-chat-mode";
/** Expert perspectives for one model (#241 stage 1b) – same list as PERSPECTIVES on the server. */
const PERSPECTIVE_KEYS = ["security", "cost", "product", "architecture", "operations", "legal"] as const;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the panel still works, it just does not remember */
  }
};

/** Translated name of a read tool ("Projekte" instead of list_projects); unknown names stay as they are. */
function useToolName() {
  const t = useTranslations("assistant.toolNames");
  return (name: string) => (t.has(name) ? t(name) : name);
}

export function AssistantPanel() {
  const t = useTranslations("assistant");
  const toolName = useToolName();
  const format = useFormatter();
  const pathname = usePathname();
  const [open, setOpenState] = useState(false);
  const [tab, setTabState] = useState<Tab>("chat");
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [limits, setLimits] = useState({ daily: "", monthly: "" });
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  // #215 stage 1: "prepare a project with me" – the answers ask for what a council needs and carry a checklist.
  const [interview, setInterview] = useState(false);
  // #486 part 3: report the conversation – explanation, the server's exact excerpt as preview, explicit consent.
  const [report, setReport] = useState<{ excerpt: string | null; explanation: string; consent: boolean; busy: boolean } | null>(null);
  const [reportNote, setReportNote] = useState<string | null>(null);
  // #241 stage 2: cross-checks of council-chat answers; the preview (models + tokens) is shown before anything is paid.
  const [checks, setChecks] = useState<Check[]>([]);
  const [checking, setChecking] = useState<string | null>(null);
  const [checkPreview, setCheckPreview] = useState<{ messageId: string; tokens: number; checks: number } | null>(null);
  const [summaryUntil, setSummaryUntil] = useState<string | null>(null);
  // #241: "single" = one model (optionally from an expert perspective), "council" = 2–4 models answer as own voices.
  const [chatMode, setChatModeState] = useState<"single" | "council">("single");
  const [councilModels, setCouncilModels] = useState<string[]>([]);
  const [perspective, setPerspective] = useState("");
  const [estimate, setEstimate] = useState<{ answers: number; withCheck: number; answering: number } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryNote, setSummaryNote] = useState<string | null>(null);
  const [model, setModel] = useState<string>(""); // "credentialId|modelId"
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Streaming (#284): the answer as it arrives, and the tool currently being read.
  const [streamText, setStreamText] = useState("");
  const [streamTool, setStreamTool] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const tabButtonRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Page context: on a decision or project page the question is about it (visible, removable). #486: the quick
  // questions follow the page as well.
  const sessionId = pathname?.match(/^\/sessions\/(ses_[\w]+)/)?.[1] ?? null;
  const projectId = sessionId ? null : (pathname?.match(/^\/projects\/(prj_[\w]+)/)?.[1] ?? null);
  const pageContext = sessionId ? { kind: "session", id: sessionId } : projectId ? { kind: "project", id: projectId } : null;
  const quickQuestions = sessionId
    ? (["summary", "against", "next"] as const)
    : projectId
      ? (["projectGaps", "projectReady", "projectRisks"] as const)
      : (["open", "waiting", "summary"] as const);
  const [useContext, setUseContext] = useState(true);
  useEffect(() => {
    setUseContext(true);
  }, [sessionId, projectId]);

  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
    write(STORE_OPEN, value ? "1" : "0");
    document.body.dataset.assistant = value ? "open" : "closed";
    if (value) setTimeout(() => inputRef.current?.focus(), 260);
    else tabButtonRef.current?.focus();
  }, []);
  const setTab = (value: Tab) => {
    setTabState(value);
    write(STORE_TAB, value);
  };

  useEffect(() => {
    const wasOpen = read(STORE_OPEN) === "1";
    setOpenState(wasOpen);
    document.body.dataset.assistant = wasOpen ? "open" : "closed";
    const savedTab = read(STORE_TAB);
    if (savedTab === "chat" || savedTab === "history" || savedTab === "settings") setTabState(savedTab);
    setModel(read(STORE_MODEL) ?? "");
    if (read(STORE_CHAT_MODE) === "council") setChatModeState("council");
    return () => {
      delete document.body.dataset.assistant;
    };
  }, []);

  // openAssistant({ prompt }) from anywhere in the app (#279): opens the chat tab with the question pre-filled – never
  // sent automatically (a question costs tokens), and with the page context switched on.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      setTab("chat");
      setUseContext(true);
      if (typeof prompt === "string" && prompt.trim()) setInput(prompt.slice(0, 4_000));
      setOpen(true);
    };
    window.addEventListener(OPEN_ASSISTANT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, onOpen);
  }, [setOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === "Escape" && open && !e.defaultPrevented) {
        // An open dropdown inside the panel handles Escape itself (closes only the list).
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Models from the user's own keys and the stored assistant settings (#281), loaded once when the panel is first opened.
  useEffect(() => {
    if (!open || credentials) return;
    Promise.all([
      fetchJson<{ credentials: Credential[] }>("/api/models"),
      fetchJson<{ preference: Preference; budget: Budget }>("/api/assistant/preferences").catch(() => null),
    ])
      .then(([r, settings]) => {
        setCredentials(r.credentials);
        if (settings) applySettings(settings);
        const exists = (value: string | null | undefined) =>
          Boolean(value && r.credentials.some((c) => c.models.some((m) => `${c.credentialId}|${m.modelId}` === value)));
        const stored = settings?.preference.credentialId ? `${settings.preference.credentialId}|${settings.preference.modelId}` : null;
        const first = r.credentials.find((c) => c.models.length);
        setModel((current) => (exists(stored) ? stored! : exists(current) ? current : first ? `${first.credentialId}|${first.models[0]!.modelId}` : ""));
      })
      .catch(() => setCredentials([]));
  }, [open, credentials]);

  function applySettings(settings: { preference: Preference; budget: Budget }) {
    setPreference(settings.preference);
    setBudget(settings.budget);
    setLimits({ daily: settings.preference.dailyTokenLimit?.toString() ?? "", monthly: settings.preference.monthlyTokenLimit?.toString() ?? "" });
  }

  async function saveSettings(changes: Partial<Preference>) {
    setSettingsNote(null);
    try {
      applySettings(
        await fetchJson<{ preference: Preference; budget: Budget }>("/api/assistant/preferences", { method: "PUT", body: JSON.stringify(changes) }),
      );
      setSettingsNote(t("settingsSaved"));
    } catch (err) {
      setSettingsNote(err instanceof ApiRequestError ? err.message : t("error"));
    }
  }

  // #280: in a long chat the oldest messages drop out of the model's view; a summary (on click, costs tokens) keeps them.
  const uncovered = messages
    .filter((m) => !m.reviewOf)
    .slice(0, -HISTORY_MESSAGES)
    .filter((m) => !summaryUntil || !m.createdAt || new Date(m.createdAt) > new Date(summaryUntil)).length;

  async function summarize() {
    if (!chatId) return;
    setSummarizing(true);
    setSummaryNote(null);
    try {
      const r = await fetchJson<{ summaryUntil: string; covered: number }>(`/api/assistant/chats/${chatId}/summary`, { method: "POST", body: "{}" });
      setSummaryUntil(r.summaryUntil);
      setSummaryNote(t("summaryDone", { count: r.covered }));
    } catch (err) {
      setSummaryNote(err instanceof ApiRequestError ? err.message : t("error"));
    } finally {
      setSummarizing(false);
    }
  }

  const setChatMode = (value: "single" | "council") => {
    setChatModeState(value);
    write(STORE_CHAT_MODE, value);
  };
  const modelLabel = (value: string) => {
    const [credentialId, ...rest] = value.split("|");
    const modelId = rest.join("|");
    return credentials?.find((c) => c.credentialId === credentialId)?.models.find((m) => m.modelId === modelId)?.displayName || modelId;
  };
  const participantsOf = (values: string[]) =>
    values.map((v) => {
      const [credentialId, ...rest] = v.split("|");
      return { credentialId: credentialId!, modelId: rest.join("|"), label: modelLabel(v) };
    });

  // #241: token estimate before sending in the council chat (no model call), refreshed while typing.
  useEffect(() => {
    if (chatMode !== "council" || councilModels.length < 2 || !input.trim()) {
      setEstimate(null);
      return;
    }
    const timer = setTimeout(() => {
      fetchJson<{ estimate: { answers: number; withCheck: number }; answering: string[] }>(`/api/assistant/chats/${chatId ?? "new"}/council`, {
        method: "POST",
        body: JSON.stringify({ content: input, participants: participantsOf(councilModels), preview: true }),
      })
        .then((r) => setEstimate({ ...r.estimate, answering: r.answering.length }))
        .catch(() => setEstimate(null));
    }, 600);
    return () => clearTimeout(timer);
    // participantsOf depends on credentials only for labels; the estimate does not.
  }, [chatMode, councilModels, input, chatId]);

  /** Council chat turn or single expert perspective (#241): one request, all answers come back together. */
  async function sendCouncil(content: string) {
    const participants = chatMode === "council" ? participantsOf(councilModels) : participantsOf([model]);
    setBusy(true);
    setError(null);
    setInput("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content }]);
    try {
      const r = await fetchJson<{ chatId: string; messages: Message[]; failures: Array<{ model: string; error: string }> }>(
        `/api/assistant/chats/${chatId ?? "new"}/council`,
        {
          method: "POST",
          body: JSON.stringify({
            content,
            participants,
            perspective: chatMode === "single" && perspective ? perspective : undefined,
            context: pageContext && useContext ? pageContext : undefined,
          }),
        },
      );
      setChatId(r.chatId);
      setMessages((m) => [...m, ...r.messages]);
      if (r.failures.length) setError(t("councilFailures", { list: r.failures.map((f) => `${f.model} (${f.error})`).join(", ") }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
      setInput(content);
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  async function secondOpinion(messageId: string) {
    if (!chatId) return;
    setReviewing(messageId);
    setError(null);
    try {
      const { message } = await fetchJson<{ message: Message }>(`/api/assistant/chats/${chatId}/messages/${messageId}/review`, { method: "POST", body: "{}" });
      setMessages((all) => {
        const at = all.findIndex((x) => x.id === messageId);
        return at < 0 ? [...all, message] : [...all.slice(0, at + 1), message, ...all.slice(at + 1)];
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
    } finally {
      setReviewing(null);
    }
  }

  /** Cross-check (#241 stage 2): first click shows which models check and the estimated tokens, second click runs it. */
  async function crossCheck(messageId: string, run: boolean) {
    if (!chatId) return;
    setError(null);
    if (!run) {
      try {
        const r = await fetchJson<{ estimate: { tokens: number; checks: number } }>(`/api/assistant/chats/${chatId}/messages/${messageId}/check`, {
          method: "POST",
          body: JSON.stringify({ participants: participantsOf(councilModels), preview: true }),
        });
        setCheckPreview({ messageId, tokens: r.estimate.tokens, checks: r.estimate.checks });
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : t("error"));
      }
      return;
    }
    setChecking(messageId);
    setCheckPreview(null);
    try {
      const r = await fetchJson<{ checks: Check[]; failures: Array<{ model: string; error: string }> }>(
        `/api/assistant/chats/${chatId}/messages/${messageId}/check`,
        { method: "POST", body: JSON.stringify({ participants: participantsOf(councilModels) }) },
      );
      setChecks((all) => [...all, ...r.checks]);
      if (r.failures.length) setError(t("councilFailures", { list: r.failures.map((f) => `${f.model} (${f.error})`).join(", ") }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
    } finally {
      setChecking(null);
    }
  }

  async function openReport() {
    if (!chatId) return;
    setReportNote(null);
    setReport({ excerpt: null, explanation: "", consent: false, busy: true });
    try {
      const r = await fetchJson<{ excerpt: string }>(`/api/assistant/chats/${chatId}/report`, { method: "POST", body: JSON.stringify({ preview: true }) });
      setReport({ excerpt: r.excerpt, explanation: "", consent: false, busy: false });
    } catch (err) {
      setReport(null);
      setReportNote(err instanceof ApiRequestError ? err.message : t("error"));
    }
  }

  async function sendReport() {
    if (!chatId || !report) return;
    setReport({ ...report, busy: true });
    try {
      await fetchJson(`/api/assistant/chats/${chatId}/report`, {
        method: "POST",
        body: JSON.stringify({ explanation: report.explanation, consent: report.consent }),
      });
      setReport(null);
      setReportNote(t("report.sent"));
    } catch (err) {
      setReport({ ...report, busy: false });
      setReportNote(err instanceof ApiRequestError ? err.message : t("error"));
    }
  }

  const loadChats = useCallback(() => {
    fetchJson<{ chats: ChatSummary[] }>("/api/assistant/chats")
      .then((r) => setChats(r.chats))
      .catch(() => setChats([]));
  }, []);
  useEffect(() => {
    if (open && tab === "history") loadChats();
  }, [open, tab, loadChats]);
  // Block body on purpose: an effect must never return the value of a DOM call – browser extensions patch
  // scrollIntoView, and React then treated its return value as a cleanup function ("i is not a function", 06.11.26).
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  async function openChat(id: string) {
    const r = await fetchJson<{ chat: { summaryUntil: string | null }; messages: Message[]; checks?: Check[] }>(`/api/assistant/chats/${id}`);
    setChatId(id);
    setMessages(r.messages);
    setChecks(r.checks ?? []);
    setCheckPreview(null);
    setInterview(Boolean(interviewOf(r.messages)));
    setReport(null);
    setReportNote(null);
    setSummaryUntil(r.chat.summaryUntil);
    setSummaryNote(null);
    setTab("chat");
  }

  async function removeChat(id: string) {
    await fetchJson(`/api/assistant/chats/${id}`, { method: "DELETE" });
    if (id === chatId) newChat();
    loadChats();
  }

  function newChat() {
    setChatId(null);
    setMessages([]);
    setChecks([]);
    setCheckPreview(null);
    setInterview(false);
    setReport(null);
    setReportNote(null);
    setSummaryUntil(null);
    setSummaryNote(null);
    setError(null);
    setTab("chat");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  /**
   * Sends the typed question. `override` (#241 stage 3): a prepared question answered by one given model in the normal
   * 1-model path – e.g. "make it a council" after a council chat, which comes back with action cards.
   */
  async function send(override?: { content: string; model: string }) {
    const content = (override?.content ?? input).trim();
    if (!content || busy) return;
    if (!override && chatMode === "council") {
      if (councilModels.length < 2) return void setError(t("councilPickModels"));
      return void sendCouncil(content);
    }
    if (!override && perspective && model) return void sendCouncil(content);
    const [credentialId, modelId] = (override?.model ?? model).split("|");
    if (!credentialId || !modelId) {
      setError(t("chooseModel"));
      setTab("settings");
      return;
    }
    setBusy(true);
    setError(null);
    if (!override) setInput("");
    setStreamText("");
    setStreamTool(null);
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await streamAnswer(
        `/api/assistant/chats/${chatId ?? "new"}/messages`,
        {
          content,
          credentialId,
          modelId,
          context: pageContext && useContext ? pageContext : undefined,
          interview: interview && !override ? true : undefined,
          // #583: "Make it a council" asks for a project card – the server marks the answer when none came.
          expectCard: override ? true : undefined,
        },
        controller.signal,
        (event) => {
          if (event.type === "delta") setStreamText((text) => text + event.text);
          else if (event.type === "reset") setStreamText("");
          else if (event.type === "tool") setStreamTool(event.name);
        },
      );
      setChatId(r.chatId);
      setMessages((m) => [...m, r.message]);
    } catch (err) {
      if (controller.signal.aborted) setError(t("stopped"));
      else setError(err instanceof ApiRequestError ? err.message : t("error"));
      if (!override) setInput(content);
      setMessages((m) => m.slice(0, -1));
    } finally {
      abortRef.current = null;
      setStreamText("");
      setStreamTool(null);
      setBusy(false);
    }
  }

  // At least two different models have answered in this chat – then "make it a council" makes sense (#241 stage 3).
  const councilAnswered = new Set(messages.filter((m) => m.role === "assistant" && !m.reviewOf && m.model).map((m) => m.model)).size > 1;
  /** Council models that may still check an answer: not its author, not already checked it (#241 stage 2). */
  const uncheckedBy = (m: Message) =>
    councilModels
      .map((v) => v.split("|").slice(1).join("|"))
      .filter((id) => !sameModelId(m.model, id) && !checks.some((c) => c.messageId === m.id && sameModelId(c.model, id)));
  // Hidden right after it was used: the latest question is the prepared one (the cards are in the answer below it).
  const justMadeCouncil = [...messages].reverse().find((m) => m.role === "user")?.content === t("makeCouncilPrompt");
  const noModels = credentials !== null && !credentials.some((c) => c.models.length);

  return (
    <>
      {/* Vertical tab on the right edge – hidden while the drawer is open. */}
      <button
        ref={tabButtonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="assistant-panel"
        aria-label={t("open")}
        className={`fixed right-0 bottom-28 z-40 flex flex-col items-center gap-2 rounded-l-xl border border-r-0 border-glass-line bg-surface/90 px-2 py-3 text-xs font-medium text-text shadow-lg backdrop-blur-xl transition-opacity hover:text-primary md:top-[45%] md:bottom-auto ${
          open ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        title={t("shortcut")}
      >
        <SparkIcon />
        <span className="[writing-mode:vertical-rl]">{t("tab")}</span>
        <span aria-hidden="true">‹</span>
      </button>

      <aside
        id="assistant-panel"
        aria-label={t("title")}
        aria-hidden={!open}
        className={`fixed inset-x-2 top-16 bottom-24 z-50 flex flex-col rounded-2xl border border-glass-line bg-surface/95 shadow-2xl backdrop-blur-xl transition-[transform,visibility] duration-250 motion-reduce:transition-none md:inset-x-auto md:top-4 md:right-3 md:bottom-4 md:w-[min(440px,calc(100vw-24px))] ${
          open ? "visible translate-x-0" : "invisible translate-x-[calc(100%+24px)]"
        }`}
      >
        {/* Collapse handle sticking out on the left (desktop). */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("close")}
          tabIndex={open ? 0 : -1}
          className="absolute top-1/2 -left-[18px] hidden h-12 w-[18px] -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-glass-line bg-surface text-muted hover:text-text md:flex"
        >
          ›
        </button>

        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <SparkIcon />
            <div>
              <p className="text-sm font-semibold">{t("title")}</p>
              <p className="text-[11px] text-muted">{t("subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            tabIndex={open ? 0 : -1}
            aria-label={t("close")}
            className="rounded-lg px-2 py-1 text-lg text-muted hover:text-text"
          >
            ×
          </button>
        </header>

        <nav className="flex gap-1 border-b border-line px-3 py-2 text-xs" role="tablist">
          {(["chat", "history", "settings"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              tabIndex={open ? 0 : -1}
              onClick={() => setTab(key)}
              className={`rounded-lg px-2.5 py-1 ${tab === key ? "bg-primary/15 text-text" : "text-muted hover:text-text"}`}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
          <button type="button" onClick={newChat} tabIndex={open ? 0 : -1} className="ml-auto rounded-lg px-2.5 py-1 text-muted hover:text-text">
            + {t("newChat")}
          </button>
        </nav>

        {tab === "chat" ? (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
              {uncovered > 0 && chatId ? (
                <div className="rounded-xl border border-warning/40 bg-warning/5 p-2.5 text-xs">
                  <p>{t("summaryHint", { count: uncovered })}</p>
                  <button
                    type="button"
                    className="mt-1.5 rounded-lg border border-line px-2.5 py-1 hover:border-primary disabled:opacity-50"
                    disabled={summarizing || busy}
                    onClick={() => void summarize()}
                  >
                    {summarizing ? t("summaryBusy") : t("summaryCreate")}
                  </button>
                </div>
              ) : null}
              {summaryNote ? (
                <p className="text-xs text-muted" role="status">
                  {summaryNote}
                </p>
              ) : null}
              {interview ? <InterviewBanner items={interviewOf(messages)} onEnd={() => setInterview(false)} /> : null}
              {messages.length === 0 ? (
                <div className="space-y-2 text-sm text-muted">
                  {!interview && chatMode === "single" ? (
                    <button
                      type="button"
                      tabIndex={open ? 0 : -1}
                      className="w-full rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-left text-xs text-text hover:border-primary"
                      onClick={() => {
                        setInterview(true);
                        inputRef.current?.focus();
                      }}
                      data-testid="start-interview"
                    >
                      <span className="block font-medium text-primary">{t("interview.start")}</span>
                      <span className="text-muted">{t("interview.startNote")}</span>
                    </button>
                  ) : null}
                  <p>{interview ? t("interview.empty") : t("empty")}</p>
                  <ul className="space-y-1.5">
                    {quickQuestions.map((key) => (
                      <li key={key}>
                        <button
                          type="button"
                          tabIndex={open ? 0 : -1}
                          className="rounded-lg border border-line px-2.5 py-1.5 text-left text-xs hover:border-primary hover:text-text"
                          onClick={() => setInput(t(`examples.${key}`))}
                        >
                          {t(`examples.${key}`)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                messages.map((m) => (
                  <Bubble
                    key={m.id}
                    message={m}
                    chatId={chatId}
                    review={
                      m.role === "assistant" && !m.reviewOf && preference?.reviewerModelId && !messages.some((x) => x.reviewOf === m.id)
                        ? { busy: reviewing === m.id, disabled: busy || reviewing !== null, run: () => void secondOpinion(m.id) }
                        : null
                    }
                    checks={checks.filter((c) => c.messageId === m.id)}
                    sensitive={m.role === "assistant" && isSensitiveTopic(questionBefore(messages, m.id))}
                    crossCheck={
                      m.role === "assistant" && !m.reviewOf && chatId && !m.id.startsWith("local-") && chatMode === "council" && uncheckedBy(m).length > 0
                        ? {
                            busy: checking === m.id,
                            disabled: busy || checking !== null,
                            preview: checkPreview?.messageId === m.id ? checkPreview : null,
                            ask: () => void crossCheck(m.id, false),
                            run: () => void crossCheck(m.id, true),
                            cancel: () => setCheckPreview(null),
                          }
                        : null
                    }
                    onAction={(updated) =>
                      setMessages((all) =>
                        all.map((x) => (x.id === m.id ? { ...x, actions: (x.actions ?? []).map((a) => (a.id === updated.id ? updated : a)) } : x)),
                      )
                    }
                    retryCard={
                      // #583: only under the latest answer, with the question that asked for the card.
                      m.id === messages[messages.length - 1]?.id && !busy && (councilModels[0] || model)
                        ? () => void send({ content: questionBefore(messages, m.id), model: councilModels[0] || model })
                        : null
                    }
                  />
                ))
              )}
              {busy && streamText ? (
                <div className="mr-4 rounded-2xl rounded-bl-sm border border-line bg-surface-2/60 px-3 py-2 text-sm">
                  {/* An unfinished trailing [label](/href …) waits until it is complete instead of showing raw. */}
                  <Markdown text={streamText.replace(/\[[^\]\n]*(\]\([^)\s]*)?$/, "")} />
                  <span aria-hidden="true" className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary/70 align-middle motion-reduce:animate-none" />
                </div>
              ) : null}
              {busy && !streamText ? (
                <p className="text-xs text-muted" role="status">
                  {streamTool ? t("readingTool", { tool: toolName(streamTool) }) : t("thinking")}
                </p>
              ) : null}
              {/* #241 stage 3: after a council chat, one model drafts the project and requirements as action cards. */}
              {chatMode === "council" && councilModels.length >= 2 && chatId && !busy && councilAnswered && !justMadeCouncil ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[11px]" data-testid="make-council">
                  <button
                    type="button"
                    className="rounded-full border border-primary px-2 py-0.5 font-medium text-primary hover:bg-primary/10"
                    onClick={() => void send({ content: t("makeCouncilPrompt"), model: councilModels[0]! })}
                  >
                    {t("makeCouncil")}
                  </button>
                  <p className="mt-1 text-muted">{t("makeCouncilNote", { model: modelLabel(councilModels[0]!) })}</p>
                </div>
              ) : null}
              {chatId && messages.length > 0 && !busy ? (
                <div className="text-[11px] text-muted" data-testid="report-conversation">
                  {report ? (
                    <div className="space-y-2 rounded-xl border border-line bg-surface-2/60 p-3">
                      <p className="font-medium text-text">{t("report.title")}</p>
                      <label className="block">
                        <span>{t("report.explanation")}</span>
                        <textarea
                          value={report.explanation}
                          maxLength={800}
                          rows={3}
                          onChange={(e) => setReport({ ...report, explanation: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-text focus:border-primary focus:outline-none"
                        />
                      </label>
                      <p>{t("report.previewLabel")}</p>
                      <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-surface p-2 text-[11px] break-words whitespace-pre-wrap text-text">
                        {report.excerpt ?? t("thinking")}
                      </pre>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={report.consent}
                          onChange={(e) => setReport({ ...report, consent: e.target.checked })}
                          className="mt-0.5"
                        />
                        <span>{t("report.consent")}</span>
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-full border border-primary px-2 py-0.5 text-primary hover:bg-primary/10 disabled:opacity-50"
                          disabled={report.busy || !report.consent || report.explanation.trim().length < 3 || !report.excerpt}
                          onClick={() => void sendReport()}
                        >
                          {t("report.send")}
                        </button>
                        <button type="button" className="rounded-full border border-line px-2 py-0.5 hover:text-text" onClick={() => setReport(null)}>
                          {t("crossCheckCancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="underline hover:text-text" onClick={() => void openReport()}>
                      {t("report.open")}
                    </button>
                  )}
                  {reportNote ? (
                    <p className="mt-1" role="status">
                      {reportNote}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
            <div className="border-t border-line p-3">
              {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
              {noModels ? (
                <p className="mb-2 text-xs text-warning">
                  {t("noKey")}{" "}
                  <Link href="/settings/providers" className="underline">
                    {t("addKey")}
                  </Link>
                </p>
              ) : null}
              {pageContext && useContext ? (
                <p className="mb-2 flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="rounded-full border border-primary/40 px-2 py-0.5 text-primary">
                    {t(pageContext.kind === "session" ? "contextSession" : "contextProject")}
                  </span>
                  <button type="button" className="underline" onClick={() => setUseContext(false)} tabIndex={open ? 0 : -1}>
                    {t("removeContext")}
                  </button>
                </p>
              ) : null}
              {/* #241: one model (optionally an expert perspective) or a council chat of 2–4 models. */}
              <div className="mb-2 space-y-1.5 text-[11px]">
                <div className="flex items-center gap-1" role="radiogroup" aria-label={t("chatModeLabel")}>
                  {(["single", "council"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={chatMode === m}
                      onClick={() => setChatMode(m)}
                      tabIndex={open ? 0 : -1}
                      className={`rounded-full border px-2.5 py-0.5 ${chatMode === m ? "border-primary bg-primary/15 text-primary" : "border-line text-muted hover:text-text"}`}
                    >
                      {t(m === "single" ? "modeSingle" : "modeCouncil")}
                    </button>
                  ))}
                </div>
                {chatMode === "council" ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1">
                      {councilModels.map((v) => (
                        <span key={v} className="flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-primary">
                          {modelLabel(v)}
                          <button
                            type="button"
                            aria-label={t("councilRemoveModel", { model: modelLabel(v) })}
                            onClick={() => setCouncilModels((all) => all.filter((x) => x !== v))}
                            tabIndex={open ? 0 : -1}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      {councilModels.length < 4 ? (
                        <Select
                          aria-label={t("councilAddModel")}
                          className="max-w-[12rem]"
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) setCouncilModels((all) => (all.includes(v) || all.length >= 4 ? all : [...all, v]));
                          }}
                          tabIndex={open ? 0 : -1}
                        >
                          <option value="">{t("councilAddModel")}</option>
                          {(credentials ?? []).map((c) => (
                            <optgroup key={c.credentialId} label={`${c.provider} · ${c.label}`}>
                              {c.models
                                .filter((m) => !councilModels.includes(`${c.credentialId}|${m.modelId}`))
                                .map((m) => (
                                  <option key={m.modelId} value={`${c.credentialId}|${m.modelId}`}>
                                    {m.displayName || m.modelId}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                        </Select>
                      ) : null}
                    </div>
                    <p className="text-muted">
                      {councilModels.length < 2
                        ? t("councilPickModels")
                        : estimate
                          ? t("councilEstimate", {
                              answers: format.number(estimate.answers),
                              n: estimate.answering,
                              check: format.number(estimate.withCheck),
                            })
                          : t("councilHint")}
                    </p>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <span id="assistant-perspective-label" className="text-muted">
                      {t("perspective")}
                    </span>
                    <Select
                      aria-labelledby="assistant-perspective-label"
                      className="max-w-[12rem]"
                      value={perspective}
                      onChange={(e) => setPerspective(e.target.value)}
                      tabIndex={open ? 0 : -1}
                    >
                      <option value="">{t("perspectiveNone")}</option>
                      {PERSPECTIVE_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {t(`perspectives.${k}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  maxLength={4000}
                  placeholder={t("placeholder")}
                  tabIndex={open ? 0 : -1}
                  className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
                />
                {busy ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    tabIndex={open ? 0 : -1}
                    className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-text hover:border-danger hover:text-danger"
                  >
                    {t("stop")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!input.trim()}
                    tabIndex={open ? 0 : -1}
                    className="rounded-xl bg-primary px-3 py-2 text-sm font-medium text-bg disabled:opacity-40"
                  >
                    {t("send")}
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-[10px] text-muted">{t("footer")}</p>
            </div>
          </>
        ) : tab === "history" ? (
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {chats === null ? (
              <p className="text-sm text-muted">{t("loading")}</p>
            ) : chats.length === 0 ? (
              <p className="text-sm text-muted">{t("noChats")}</p>
            ) : (
              <ul className="space-y-1">
                {chats.map((c) => (
                  <li
                    key={c.id}
                    className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${c.id === chatId ? "bg-primary/10" : "hover:bg-surface-2"}`}
                  >
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openChat(c.id)} tabIndex={open ? 0 : -1}>
                      <span className="block truncate">{c.title}</span>
                      <span className="text-[11px] text-muted">{format.dateTime(new Date(c.updatedAt), { dateStyle: "medium", timeStyle: "short" })}</span>
                    </button>
                    <a
                      href={`/api/assistant/chats/${c.id}/export`}
                      download
                      className="text-xs text-muted opacity-60 hover:text-text group-hover:opacity-100"
                      aria-label={t("download", { title: c.title })}
                      title={t("download", { title: c.title })}
                      tabIndex={open ? 0 : -1}
                    >
                      ⤓
                    </a>
                    <a
                      href={`/api/assistant/chats/${c.id}/export?format=pdf`}
                      download
                      className="text-[10px] font-medium text-muted opacity-60 hover:text-text group-hover:opacity-100"
                      aria-label={t("downloadPdf", { title: c.title })}
                      title={t("downloadPdf", { title: c.title })}
                      tabIndex={open ? 0 : -1}
                    >
                      PDF
                    </a>
                    <button
                      type="button"
                      className="text-xs text-muted opacity-60 hover:text-danger group-hover:opacity-100"
                      onClick={() => void removeChat(c.id)}
                      aria-label={t("delete", { title: c.title })}
                      tabIndex={open ? 0 : -1}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted">{t("privacy")}</p>
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            <div className="block">
              <span id="assistant-model-label" className="block text-xs font-medium">
                {t("model")}
              </span>
              <Select
                aria-labelledby="assistant-model-label"
                className="mt-1"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  write(STORE_MODEL, e.target.value);
                  // Remembered on the server too (#281), so another device starts with the same model.
                  const [credentialId, ...rest] = e.target.value.split("|");
                  if (credentialId && rest.length) void saveSettings({ credentialId, modelId: rest.join("|") });
                }}
                tabIndex={open ? 0 : -1}
              >
                {credentials === null ? <option>{t("loading")}</option> : null}
                {(credentials ?? []).map((c) => (
                  <optgroup key={c.credentialId} label={`${c.provider} · ${c.label}`}>
                    {c.models.map((m) => (
                      <option key={m.modelId} value={`${c.credentialId}|${m.modelId}`}>
                        {m.displayName || m.modelId}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            <p className="text-xs text-muted">{t("modelNote")}</p>
            <div className="block">
              <span id="assistant-reviewer-label" className="block text-xs font-medium">
                {t("reviewer")}
              </span>
              <Select
                aria-labelledby="assistant-reviewer-label"
                className="mt-1"
                value={preference?.reviewerCredentialId ? `${preference.reviewerCredentialId}|${preference.reviewerModelId}` : ""}
                onChange={(e) => {
                  const [credentialId, ...rest] = e.target.value.split("|");
                  void saveSettings(
                    credentialId && rest.length
                      ? { reviewerCredentialId: credentialId, reviewerModelId: rest.join("|") }
                      : { reviewerCredentialId: null, reviewerModelId: null },
                  );
                }}
                tabIndex={open ? 0 : -1}
              >
                <option value="">{t("reviewerNone")}</option>
                {(credentials ?? []).map((c) => (
                  <optgroup key={c.credentialId} label={`${c.provider} · ${c.label}`}>
                    {c.models.map((m) => (
                      <option key={m.modelId} value={`${c.credentialId}|${m.modelId}`}>
                        {m.displayName || m.modelId}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted">{t("reviewerNote")}</p>
            </div>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const parse = (v: string) => (v.trim() ? Number(v.replace(/[^0-9]/g, "")) : null);
                void saveSettings({ dailyTokenLimit: parse(limits.daily), monthlyTokenLimit: parse(limits.monthly) });
              }}
            >
              <span className="block text-xs font-medium">{t("limits")}</span>
              <div className="grid grid-cols-2 gap-2">
                {(["daily", "monthly"] as const).map((key) => (
                  <label key={key} className="block text-xs">
                    <span className="text-muted">{t(key === "daily" ? "limitDaily" : "limitMonthly")}</span>
                    <input
                      inputMode="numeric"
                      value={limits[key]}
                      onChange={(e) => setLimits((l) => ({ ...l, [key]: e.target.value }))}
                      placeholder={t("limitNone")}
                      className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
                      tabIndex={open ? 0 : -1}
                    />
                  </label>
                ))}
              </div>
              {/* #519: every call reserves its expected tokens first – a limit below one question lets nothing through. */}
              <p className="text-xs text-muted">{t("limitReserveNote", { min: format.number(MIN_QUESTION_TOKENS) })}</p>
              {(["daily", "monthly"] as const).some((key) => {
                const n = Number(limits[key].replace(/\D/g, ""));
                return limits[key].trim() !== "" && n > 0 && n < MIN_QUESTION_TOKENS;
              }) ? (
                <p className="text-xs text-warning" role="status">
                  {t("limitTooSmall", { min: format.number(MIN_QUESTION_TOKENS) })}
                </p>
              ) : null}
              {budget ? (
                <p className="text-xs text-muted">
                  {t("usage", {
                    today: format.number(budget.today),
                    month: format.number(budget.thisMonth),
                  })}
                </p>
              ) : null}
              <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-primary" tabIndex={open ? 0 : -1}>
                {t("saveLimits")}
              </button>
            </form>
            {settingsNote ? (
              <p className="text-xs text-muted" role="status">
                {settingsNote}
              </p>
            ) : null}
            <p className="text-xs text-muted">{t("readOnly")}</p>
            <p className="text-xs text-muted">{t("shortcut")}</p>
          </div>
        )}
      </aside>
    </>
  );
}

type StreamEvent = { type: "delta"; text: string } | { type: "reset" } | { type: "tool"; name: string };

/**
 * Asks with `Accept: text/event-stream` (#284) and reads the Server-Sent Events: deltas while the model writes, then
 * "done" with the stored message. Errors before the stream starts come back as the usual JSON error.
 */
async function streamAnswer(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
): Promise<{ chatId: string; message: Message }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new ApiRequestError(data?.error?.message ?? `Request failed (${response.status})`, response.status);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 2);
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5)) as StreamEvent | { type: "done"; chatId: string; message: Message } | { type: "error"; message: string };
      if (event.type === "done") return { chatId: event.chatId, message: event.message };
      if (event.type === "error") throw new ApiRequestError(event.message, 502);
      onEvent(event);
    }
  }
  throw new ApiRequestError("The answer was interrupted.", 502);
}

/** The interview checklist of the latest answer that has one (#215 stage 1). */
type InterviewItem = { key: string; status: "answered" | "assumed" | "open"; note: string };
function interviewOf(messages: Message[]): InterviewItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const marker = messages[i]!.tools?.find((x) => x.name === "_interview") as { args?: { items?: InterviewItem[] } } | undefined;
    if (marker?.args?.items) return marker.args.items;
  }
  return null;
}

/** Progress of "prepare a project with me": answered of the required points, open questions, unconfirmed assumptions. */
function InterviewBanner({ items, onEnd }: { items: InterviewItem[] | null; onEnd: () => void }) {
  const t = useTranslations("assistant");
  const required = (items ?? []).filter((i) => i.key !== "preference");
  const answered = required.filter((i) => i.status === "answered").length;
  const open = (items ?? []).filter((i) => i.status === "open" && i.key !== "preference");
  const assumed = (items ?? []).filter((i) => i.status === "assumed");
  return (
    <div className="mb-2 space-y-1 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[11px]" data-testid="interview-banner">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-primary">
          {t("interview.title")} · {items ? t("interview.progress", { done: answered, total: 6 }) : t("interview.notYet")}
        </span>
        <button type="button" className="underline hover:text-text" onClick={onEnd}>
          {t("interview.end")}
        </button>
      </div>
      {(items ?? []).find((i) => i.key === "options" && i.status !== "open" && i.note) ? (
        <p>
          {t("interview.keys.options")}: {(items ?? []).find((i) => i.key === "options")!.note}
        </p>
      ) : null}
      {open.length ? (
        <p className="text-muted">
          {t("interview.open")}: {open.map((i) => t(`interview.keys.${i.key}`)).join(", ")}
        </p>
      ) : null}
      {assumed.length ? (
        <p className="text-warning">
          {t("interview.assumed")}: {assumed.map((i) => `${t(`interview.keys.${i.key}`)}${i.note ? ` (${i.note})` : ""}`).join("; ")}
        </p>
      ) : null}
    </div>
  );
}

/** The expert perspective of a single-perspective answer (#241 stage 1b), from its marker. */
function perspectiveOf(m: Message): (typeof PERSPECTIVE_KEYS)[number] | null {
  const marker = m.tools?.find((x) => x.name === "_perspective") as { name: string; args?: { role?: string } } | undefined;
  const role = marker?.args?.role;
  return (PERSPECTIVE_KEYS as readonly string[]).includes(role ?? "") ? (role as (typeof PERSPECTIVE_KEYS)[number]) : null;
}

/** #583: the server's marker for an answer without the card it announced or was asked for. */
function cardMissingOf(m: Message): { retry: boolean } | null {
  const marker = m.tools?.find((x) => x.name === "_card_missing") as { name: string; args?: { retry?: unknown } } | undefined;
  return marker ? { retry: marker.args?.retry === true } : null;
}

/** The user's question before an answer (for the medicine/law/security guard rail of the cross-check). */
function questionBefore(messages: Message[], id: string): string {
  const at = messages.findIndex((x) => x.id === id);
  return [...messages.slice(0, Math.max(0, at))].reverse().find((x) => x.role === "user")?.content ?? "";
}

const VERDICT_ICON: Record<CheckVerdict, string> = { confirmed: "✓", contradicted: "⚠", unverifiable: "?" };

function Bubble({
  message: m,
  chatId,
  onAction,
  review,
  checks = [],
  sensitive = false,
  crossCheck,
  retryCard,
}: {
  message: Message;
  chatId: string | null;
  onAction: (a: Action) => void;
  /** #583: asks once more for the card an answer announced or should have brought (latest answer only). */
  retryCard?: (() => void) | null;
  /** Second opinion button (#281) – only under answers when a reviewer model is set. */
  review?: { busy: boolean; disabled: boolean; run: () => void } | null;
  /** Cross-checks of this answer (#241 stage 2) and whether its topic is never "verified" (medicine, law, security). */
  checks?: Check[];
  sensitive?: boolean;
  crossCheck?: {
    busy: boolean;
    disabled: boolean;
    preview: { tokens: number; checks: number } | null;
    ask: () => void;
    run: () => void;
    cancel: () => void;
  } | null;
}) {
  const t = useTranslations("assistant");
  const toolName = useToolName();
  const format = useFormatter();
  if (m.role === "user") {
    return <div className="ml-8 rounded-2xl rounded-br-sm bg-primary/15 px-3 py-2 text-sm whitespace-pre-wrap">{m.content}</div>;
  }
  return (
    <div
      className={`mr-4 rounded-2xl rounded-bl-sm border px-3 py-2 text-sm ${m.reviewOf ? "ml-4 border-warning/40 bg-warning/5" : "border-line bg-surface-2/60"}`}
    >
      {m.reviewOf ? <p className="mb-1 text-[11px] font-medium text-warning">{t("secondOpinionTitle")}</p> : null}
      {perspectiveOf(m) ? (
        <p className="mb-1 text-[11px] font-medium text-warning">{t("perspectiveTitle", { role: t(`perspectives.${perspectiveOf(m)!}`) })}</p>
      ) : null}
      <Markdown text={m.content} />
      {chatId && m.actions?.length ? (
        <div className="mt-2 space-y-2">
          {m.actions.map((a) => (
            <ActionCard key={a.id} action={a} chatId={chatId} messageId={m.id} onChange={onAction} />
          ))}
        </div>
      ) : null}
      {cardMissingOf(m) && !m.actions?.length ? (
        <div role="status" className="mt-2 rounded-xl border border-warning/50 bg-warning/10 p-2.5 text-xs text-text">
          <p>{t("cardMissing")}</p>
          {cardMissingOf(m)!.retry && retryCard ? (
            <button type="button" onClick={retryCard} className="mt-1.5 rounded-lg bg-primary px-2.5 py-1 font-medium text-bg">
              {t("cardRetry")}
            </button>
          ) : null}
        </div>
      ) : null}
      {m.links?.length ? (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {m.links.slice(0, 6).map((l) => (
            <Link key={l.href} href={l.href} className="rounded-full border border-primary/40 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10">
              {l.label}
            </Link>
          ))}
        </p>
      ) : null}
      <p className="mt-1.5 text-[10px] text-muted">
        {[
          m.model,
          m.tools?.some((x) => !x.name.startsWith("_"))
            ? t("usedTools", { tools: [...new Set(m.tools.filter((x) => !x.name.startsWith("_")).map((x) => toolName(x.name)))].join(", ") })
            : null,
          m.inputTokens != null ? t("tokens", { n: format.number((m.inputTokens ?? 0) + (m.outputTokens ?? 0)) }) : null,
          m.cost ? t("cost", { amount: format.number(m.cost.amount, { style: "currency", currency: m.cost.currency, maximumSignificantDigits: 2 }) }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {review ? (
        <button
          type="button"
          className="mt-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-primary hover:text-text disabled:opacity-50"
          disabled={review.disabled}
          onClick={review.run}
        >
          {review.busy ? t("secondOpinionBusy") : t("secondOpinion")}
        </button>
      ) : null}
      {checks.length ? (
        <div className="mt-2 space-y-1 border-t border-line pt-2" data-testid="cross-checks">
          {(() => {
            const summary = checkSummary(
              checks.map((c) => c.verdict),
              sensitive,
            )!;
            const tone = summary === "confirmed" ? "text-success" : summary === "contradicted" ? "text-danger" : "text-warning";
            return (
              <p className={`text-[11px] font-medium ${tone}`}>
                {t(`checkSummary.${summary}`)}
                {sensitive ? ` – ${t("checkSensitive")}` : ""}
              </p>
            );
          })()}
          {checks.map((c) => (
            <p key={c.id} className="text-[11px]">
              <span aria-label={t(`checkVerdict.${c.verdict}`)} title={t(`checkVerdict.${c.verdict}`)} className="mr-1 font-semibold">
                {VERDICT_ICON[c.verdict]}
              </span>
              <span className="text-muted">{c.model}:</span> {c.reason}
            </p>
          ))}
        </div>
      ) : null}
      {crossCheck ? (
        crossCheck.preview ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-muted">{t("crossCheckConfirm", { n: crossCheck.preview.checks, tokens: format.number(crossCheck.preview.tokens) })}</span>
            <button type="button" className="rounded-full border border-primary px-2 py-0.5 text-primary hover:bg-primary/10" onClick={crossCheck.run}>
              {t("crossCheckRun")}
            </button>
            <button type="button" className="rounded-full border border-line px-2 py-0.5 text-muted hover:text-text" onClick={crossCheck.cancel}>
              {t("crossCheckCancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mt-1.5 ml-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-primary hover:text-text disabled:opacity-50"
            disabled={crossCheck.disabled}
            onClick={crossCheck.ask}
          >
            {crossCheck.busy ? t("crossCheckBusy") : t("crossCheck")}
          </button>
        )
      ) : null}
    </div>
  );
}

const TEXT_ACTIONS = new Set(["draft_customer_summary", "prepare_delivery"]);
/** Parameters shown read-only (ids and fixed choices); everything else can be edited before running. */
const FIXED_PARAMS = new Set(["projectId", "sessionId", "type", "channel"]);
/** Fixed display order, so the fields do not jump when the server returns the validated parameters (live test 06.11.26). */
const FIELD_ORDER = ["name", "type", "channel", "subject", "idea", "goal", "requirements", "text"];
const byFieldOrder = ([a]: [string, unknown], [b]: [string, unknown]) =>
  (FIELD_ORDER.indexOf(a) + 1 || FIELD_ORDER.length + 1) - (FIELD_ORDER.indexOf(b) + 1 || FIELD_ORDER.length + 1);

/**
 * One suggested action (#283) as a card: Run / Edit / Dismiss. Running goes through the server, which checks the
 * allowlist and the user's permissions again; text drafts are copied to the clipboard and never sent.
 */
function ActionCard(props: { action: Action; chatId: string; messageId: string; onChange: (a: Action) => void }) {
  // #215 stage 2: a council start has its own card – cost preview, "costs confirmed", one start, then the status.
  if (props.action.type === "start_council") return <CouncilStartCard {...props} />;
  return <GenericActionCard {...props} />;
}

type CouncilPreview = {
  project: { id: string; name: string };
  models: string[];
  tokenBudget: number;
  upperBound: number;
  minimumBudget: number;
  typical: number | null;
  shortened: boolean;
  planLimit: string | null;
  finalVerdict: string | null;
  requirements: { current: boolean; version?: number; message?: string };
  startable: boolean;
};

function CouncilStartCard({ action, chatId, messageId, onChange }: { action: Action; chatId: string; messageId: string; onChange: (a: Action) => void }) {
  const t = useTranslations("assistant.councilStart");
  const format = useFormatter();
  const [preview, setPreview] = useState<{ data: CouncilPreview; hash: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ status: string; phase: string | null; tokens: number } | null>(null);
  const base = `/api/assistant/chats/${chatId}/messages/${messageId}/actions/${action.id}`;
  const sessionId = action.result?.href?.match(/^\/sessions\/(ses_[\w]+)/)?.[1] ?? null;

  const loadPreview = useCallback(async () => {
    setError(null);
    try {
      const r = await fetchJson<{ preview: CouncilPreview; previewHash: string }>(`${base}/council`, {
        method: "POST",
        body: JSON.stringify({ preview: true }),
      });
      setPreview({ data: r.preview, hash: r.previewHash });
      setConsent(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("failed"));
    }
  }, [base, t]);

  useEffect(() => {
    if (action.status === "proposed") void loadPreview();
  }, [action.status, loadPreview]);

  // After the start: the session's live status – #12's server-sent `usage` event, polling as fallback.
  useEffect(() => {
    if (!sessionId) return;
    return followSessionStatus(sessionId, setStatus, {
      createSource: typeof EventSource === "undefined" ? null : (url) => new EventSource(url) as never,
      load: async () => {
        const r = await fetchJson<{ session: { status: string; currentPhase: string | null; tokensUsed: number } }>(`/api/sessions/${sessionId}`);
        return { status: r.session.status, phase: r.session.currentPhase, tokens: r.session.tokensUsed };
      },
    });
  }, [sessionId]);

  async function start() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJson<{ action: Action }>(`${base}/council`, {
        method: "POST",
        body: JSON.stringify({ confirmCosts: consent, previewHash: preview.hash }),
      });
      onChange(r.action);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("failed"));
      // Something changed (409) or a limit hit: show the current preview again before another try.
      void loadPreview();
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      const r = await fetchJson<{ action: Action }>(base, { method: "POST", body: JSON.stringify({ decision: "dismiss" }) });
      onChange(r.action);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  const n = (v: number) => format.number(v);
  return (
    <div className="space-y-1.5 rounded-xl border border-primary/35 bg-surface/70 p-2.5 text-xs" data-testid="council-start-card">
      <p className="font-medium text-text">{t("title")}</p>
      {action.status === "executed" && sessionId ? (
        <>
          <p className="text-success">{t("started")}</p>
          {status ? <p className="text-muted">{t("status", { status: status.status, phase: status.phase ?? "–", tokens: n(status.tokens) })}</p> : null}
          {/* #215 stage 3: once the verdict is there, the card leads to it and to the next steps (#273/#266). */}
          {status && ["awaiting_approval", "approved", "completed", "rejected"].includes(status.status) ? (
            <p className="text-text">{t("verdictReady")}</p>
          ) : null}
          <Link href={action.result!.href} className="text-primary underline">
            {t("open", { name: action.result!.label })}
          </Link>
        </>
      ) : action.status === "dismissed" ? (
        <p className="text-muted">{t("dismissed")}</p>
      ) : preview ? (
        <>
          <p>
            <span className="text-muted">{t("project")}:</span> {preview.data.project.name}
          </p>
          <p>
            <span className="text-muted">{t("models")}:</span> {preview.data.models.join(", ")}
          </p>
          <p>
            <span className="text-muted">{t("budget")}:</span> {n(preview.data.tokenBudget)} · {t("upperBound", { tokens: n(preview.data.upperBound) })}
            {preview.data.typical ? ` · ${t("typical", { tokens: n(preview.data.typical) })}` : ""}
          </p>
          {preview.data.tokenBudget < preview.data.minimumBudget ? (
            // Live test 08.11.26: below the minimum the card was only disabled – say why and what is needed.
            <p className="text-warning">{t("budgetTooSmall", { min: n(preview.data.minimumBudget) })}</p>
          ) : preview.data.shortened ? (
            <p className="text-warning">{t("shortened")}</p>
          ) : null}
          {!preview.data.requirements.current ? <p className="text-warning">{t("requirementsNotCurrent")}</p> : null}
          {preview.data.planLimit ? <p className="text-warning">{preview.data.planLimit}</p> : null}
          {preview.data.finalVerdict ? <p className="text-warning">{preview.data.finalVerdict}</p> : null}
          <p className="text-muted">{t("note")}</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consent} disabled={!preview.data.startable} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>{t("consent", { tokens: n(preview.data.tokenBudget) })}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-text disabled:opacity-50"
              disabled={busy || !consent || !preview.data.startable}
              onClick={() => void start()}
            >
              {busy ? t("starting") : t("start")}
            </button>
            <Link href={`/projects/${preview.data.project.id}/council/new`} className="rounded-full border border-line px-2.5 py-0.5 hover:border-primary">
              {t("adjust")}
            </Link>
            <button
              type="button"
              className="rounded-full border border-line px-2.5 py-0.5 text-muted hover:text-text"
              disabled={busy}
              onClick={() => void dismiss()}
            >
              {t("dismiss")}
            </button>
          </div>
        </>
      ) : (
        <p className="text-muted">{t("loading")}</p>
      )}
      {error ? <p className="text-danger">{error}</p> : null}
    </div>
  );
}

function GenericActionCard({ action, chatId, messageId, onChange }: { action: Action; chatId: string; messageId: string; onChange: (a: Action) => void }) {
  const t = useTranslations("assistant.actions");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(action.params);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isText = TEXT_ACTIONS.has(action.type);
  const known = ["create_project_draft", "draft_brief", "propose_requirements", "prepare_council", "draft_customer_summary", "prepare_delivery"].includes(
    action.type,
  );

  async function decide(decision: "execute" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      const params = editing ? draft : undefined;
      if (decision === "execute" && isText) {
        const p = params ?? action.params;
        const textValue = [typeof p.subject === "string" && p.subject ? p.subject : null, String(p.text ?? "")].filter(Boolean).join("\n\n");
        try {
          await navigator.clipboard.writeText(textValue);
          setCopied(true);
        } catch {
          /* clipboard blocked: the text stays visible to copy by hand */
        }
      }
      const r = await fetchJson<{ action: Action }>(`/api/assistant/chats/${chatId}/messages/${messageId}/actions/${action.id}`, {
        method: "POST",
        body: JSON.stringify({ decision, params }),
      });
      setEditing(false);
      onChange(r.action);
      if (decision === "execute" && r.action.result?.href && action.type === "prepare_council") router.push(r.action.result.href);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  const shown = editing ? draft : action.params;
  return (
    <div className="rounded-xl border border-primary/35 bg-surface/70 p-2.5 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-text">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">{known ? t(`types.${action.type}`) : action.type}</span>
        <span className="min-w-0 flex-1">{action.summary}</span>
      </p>
      <dl className="mt-2 space-y-1.5">
        {Object.entries(shown)
          .sort(byFieldOrder)
          .map(([key, value]) => {
            // Ids are for the server; the summary and the result link name the project or decision.
            if (value === null || value === undefined || value === "" || key === "projectId" || key === "sessionId") return null;
            const label = t.has(`fields.${key}`) ? t(`fields.${key}`) : key;
            if (editing && !FIXED_PARAMS.has(key)) {
              const isList = Array.isArray(value);
              const asText = isList ? (value as unknown[]).map(String).join("\n") : String(value);
              return (
                <div key={key}>
                  <dt className="text-[10px] text-muted">{isList ? `${label} (${t("onePerLine")})` : label}</dt>
                  <dd>
                    <textarea
                      value={asText}
                      rows={key === "name" || key === "subject" ? 1 : Math.min(8, Math.max(2, asText.split("\n").length))}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [key]: isList
                            ? e.target.value
                                .split("\n")
                                .map((l) => l.trim())
                                .filter(Boolean)
                            : e.target.value,
                        }))
                      }
                      aria-label={label}
                      className="mt-0.5 w-full resize-y rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                  </dd>
                </div>
              );
            }
            return (
              <div key={key}>
                <dt className="text-[10px] text-muted">{label}</dt>
                <dd className="whitespace-pre-wrap text-text/90">
                  {Array.isArray(value) ? (
                    <ul className="list-disc pl-4">
                      {value.map((v, i) => (
                        <li key={i}>{String(v)}</li>
                      ))}
                    </ul>
                  ) : (key === "type" || key === "channel") && t.has(`values.${String(value)}`) ? (
                    t(`values.${String(value)}`)
                  ) : (
                    <span className={String(value).length > 400 && !isText ? "line-clamp-4" : undefined}>{String(value)}</span>
                  )}
                </dd>
              </div>
            );
          })}
      </dl>
      {error ? <p className="mt-2 text-danger">{error}</p> : null}
      {action.status === "proposed" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide("execute")}
            className={`rounded-lg bg-primary font-medium text-bg disabled:opacity-40 ${action.type === "create_project_draft" ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-1"}`}
          >
            {t(isText ? "copy" : action.type === "prepare_council" ? "openForm" : action.type === "create_project_draft" ? "runCreateProject" : "run")}
          </button>
          {action.type !== "prepare_council" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(action.params);
                setEditing((v) => !v);
              }}
              className="rounded-lg border border-line px-2.5 py-1 hover:border-primary"
            >
              {editing ? t("cancelEdit") : t("edit")}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => void decide("dismiss")} className="rounded-lg px-2 py-1 text-muted hover:text-danger">
            {t("dismiss")}
          </button>
          <span className="w-full text-[10px] text-muted">{t(isText ? "noteText" : action.type === "prepare_council" ? "noteCouncil" : "noteRun")}</span>
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-muted">
          {action.status === "executed" ? t(isText ? (copied ? "copiedDone" : "textDone") : "done") : t("dismissed")}
          {action.status === "executed" && isText ? (
            <>
              {" · "}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => {
                  const p = action.params;
                  const value = [typeof p.subject === "string" && p.subject ? p.subject : null, String(p.text ?? "")].filter(Boolean).join("\n\n");
                  navigator.clipboard.writeText(value).then(
                    () => setCopied(true),
                    () => undefined,
                  );
                }}
              >
                {t("copyAgain")}
              </button>
            </>
          ) : null}
          {action.edited ? ` · ${t("edited")}` : ""}
          {action.status === "executed" && action.type === "draft_customer_summary" && chatId ? (
            <>
              {" · "}
              {(["pdf", "docx"] as const).map((f, i) => (
                <Fragment key={f}>
                  {i ? " · " : null}
                  <a
                    href={`/api/assistant/chats/${chatId}/messages/${messageId}/actions/${action.id}/document?format=${f}`}
                    download
                    className="text-primary underline"
                  >
                    {t(f === "pdf" ? "summaryPdf" : "summaryWord")}
                  </a>
                </Fragment>
              ))}
            </>
          ) : null}
          {action.result?.href ? (
            <>
              {" · "}
              <Link href={action.result.href} className="text-primary underline">
                {action.result.label || t("open")}
              </Link>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

function SparkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-primary" strokeWidth={1.8}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" strokeLinecap="round" />
    </svg>
  );
}
