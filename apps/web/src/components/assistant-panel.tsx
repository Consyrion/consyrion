"use client";

import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
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
  tools?: Array<{ name: string }> | null;
  links?: Array<{ label: string; href: string }> | null;
  actions?: Action[] | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
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

const STORE_OPEN = "consyrion-assistant-open";
const STORE_TAB = "consyrion-assistant-tab";
const STORE_MODEL = "consyrion-assistant-model";

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

export function AssistantPanel() {
  const t = useTranslations("assistant");
  const format = useFormatter();
  const pathname = usePathname();
  const [open, setOpenState] = useState(false);
  const [tab, setTabState] = useState<Tab>("chat");
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
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

  // Page context: on a decision page the question is about that decision (visible, removable).
  const sessionId = pathname?.match(/^\/sessions\/(ses_[\w]+)/)?.[1] ?? null;
  const [useContext, setUseContext] = useState(true);
  useEffect(() => {
    setUseContext(true);
  }, [sessionId]);

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
    return () => {
      delete document.body.dataset.assistant;
    };
  }, []);

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

  // Models from the user's own keys, loaded once when the panel is first opened.
  useEffect(() => {
    if (!open || credentials) return;
    fetchJson<{ credentials: Credential[] }>("/api/models")
      .then((r) => {
        setCredentials(r.credentials);
        const first = r.credentials.find((c) => c.models.length);
        setModel((current) => {
          const valid = current && r.credentials.some((c) => c.models.some((m) => `${c.credentialId}|${m.modelId}` === current));
          return valid ? current : first ? `${first.credentialId}|${first.models[0]!.modelId}` : "";
        });
      })
      .catch(() => setCredentials([]));
  }, [open, credentials]);

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
    const r = await fetchJson<{ messages: Message[] }>(`/api/assistant/chats/${id}`);
    setChatId(id);
    setMessages(r.messages);
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
    setError(null);
    setTab("chat");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    const [credentialId, modelId] = model.split("|");
    if (!credentialId || !modelId) {
      setError(t("chooseModel"));
      setTab("settings");
      return;
    }
    setBusy(true);
    setError(null);
    setInput("");
    setStreamText("");
    setStreamTool(null);
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await streamAnswer(
        `/api/assistant/chats/${chatId ?? "new"}/messages`,
        { content, credentialId, modelId, context: sessionId && useContext ? { kind: "session", id: sessionId } : undefined },
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
      setInput(content);
      setMessages((m) => m.slice(0, -1));
    } finally {
      abortRef.current = null;
      setStreamText("");
      setStreamTool(null);
      setBusy(false);
    }
  }

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
              {messages.length === 0 ? (
                <div className="space-y-2 text-sm text-muted">
                  <p>{t("empty")}</p>
                  <ul className="space-y-1.5">
                    {(["open", "waiting", "summary"] as const).map((key) => (
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
                    onAction={(updated) =>
                      setMessages((all) =>
                        all.map((x) => (x.id === m.id ? { ...x, actions: (x.actions ?? []).map((a) => (a.id === updated.id ? updated : a)) } : x)),
                      )
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
                  {streamTool ? t("readingTool", { tool: streamTool }) : t("thinking")}
                </p>
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
              {sessionId && useContext ? (
                <p className="mb-2 flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="rounded-full border border-primary/40 px-2 py-0.5 text-primary">{t("contextSession")}</span>
                  <button type="button" className="underline" onClick={() => setUseContext(false)} tabIndex={open ? 0 : -1}>
                    {t("removeContext")}
                  </button>
                </p>
              ) : null}
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

function Bubble({ message: m, chatId, onAction }: { message: Message; chatId: string | null; onAction: (a: Action) => void }) {
  const t = useTranslations("assistant");
  const format = useFormatter();
  if (m.role === "user") {
    return <div className="ml-8 rounded-2xl rounded-br-sm bg-primary/15 px-3 py-2 text-sm whitespace-pre-wrap">{m.content}</div>;
  }
  return (
    <div className="mr-4 rounded-2xl rounded-bl-sm border border-line bg-surface-2/60 px-3 py-2 text-sm">
      <Markdown text={m.content} />
      {chatId && m.actions?.length ? (
        <div className="mt-2 space-y-2">
          {m.actions.map((a) => (
            <ActionCard key={a.id} action={a} chatId={chatId} messageId={m.id} onChange={onAction} />
          ))}
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
          m.tools?.length ? t("usedTools", { tools: [...new Set(m.tools.map((x) => x.name))].join(", ") }) : null,
          m.inputTokens != null ? t("tokens", { n: format.number((m.inputTokens ?? 0) + (m.outputTokens ?? 0)) }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
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
function ActionCard({ action, chatId, messageId, onChange }: { action: Action; chatId: string; messageId: string; onChange: (a: Action) => void }) {
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
            className="rounded-lg bg-primary px-2.5 py-1 font-medium text-bg disabled:opacity-40"
          >
            {t(isText ? "copy" : action.type === "prepare_council" ? "openForm" : "run")}
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

/** Small Markdown subset (paragraphs, bullets, **bold**, `code`, links) – only app-internal links become links. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isItem = (l: string) => /^\s*([-*•]|\d+\.)\s+/.test(l);
        const first = lines.findIndex(isItem);
        // "Intro sentence + list" in one block: the intro as a paragraph, the items as a list.
        if (first >= 0 && lines.slice(first).every(isItem)) {
          return (
            <div key={i} className="space-y-1">
              {first > 0 ? <p className="whitespace-pre-wrap">{inline(lines.slice(0, first).join("\n"))}</p> : null}
              <ul className="list-disc space-y-0.5 pl-4">
                {lines.slice(first).map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] && match[2]) {
      const href = match[2];
      parts.push(
        /^\/(sessions|projects|dashboard|decisions|settings)(\/[\w-]*)*\/?$/.test(href) ? (
          <Link key={match.index} href={href} className="text-primary underline">
            {match[1]}
          </Link>
        ) : (
          <Fragment key={match.index}>{match[1]}</Fragment>
        ),
      );
    } else if (match[3]) parts.push(<strong key={match.index}>{match[3]}</strong>);
    else if (match[4])
      parts.push(
        <code key={match.index} className="rounded bg-surface px-1 text-xs">
          {match[4]}
        </code>,
      );
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function SparkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-primary" strokeWidth={1.8}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" strokeLinecap="round" />
    </svg>
  );
}
