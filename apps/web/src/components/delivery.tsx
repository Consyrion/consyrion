"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField, TextField } from "./ui/field";
import { PasswordField } from "./ui/password-field";
import { Alert, Badge, Card } from "./ui/surface";

export interface DeliveryConnectionView {
  id: string;
  kind: "telegram" | "confluence";
  label: string;
  config: Record<string, string>;
  secretHint: string;
}

interface DeliveryView {
  id: string;
  target: "email" | "telegram" | "confluence";
  connectionId: string | null;
  recipient: string;
  status: "sent" | "failed";
  error: string | null;
  externalUrl: string | null;
  createdAt: string;
}

/** Settings → Integrations: Telegram and Confluence connections a decision can be sent to (#165). */
export function DeliveryConnections({
  initial,
  canWrite,
  emailConfigured,
}: {
  initial: DeliveryConnectionView[];
  canWrite: boolean;
  emailConfigured: boolean;
}) {
  const [connections, setConnections] = useState(initial);
  const [kind, setKind] = useState<"telegram" | "confluence">("telegram");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useTranslations("settings.delivery");

  /** Questions over Telegram on/off; the server registers or removes the bot's webhook. */
  async function toggleInbound(c: DeliveryConnectionView) {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/delivery-connections/${c.id}/inbound`, { method: c.config.inboundEnabledAt ? "DELETE" : "POST" });
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("inbound.error"));
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setConnections((await fetchJson<{ connections: DeliveryConnectionView[] }>("/api/delivery-connections")).connections);
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = Object.fromEntries(new FormData(formElement));
    setBusy(true);
    setError(null);
    try {
      await fetchJson("/api/delivery-connections", { method: "POST", body: JSON.stringify({ ...form, kind }) });
      formElement.reset();
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("errorSave"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await fetchJson(`/api/delivery-connections/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("errorDelete"));
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted">{t("text")}</p>
      <p className="mt-2 text-sm">
        {t("emailToMembers")} {emailConfigured ? <Badge tone="success">{t("available")}</Badge> : <Badge tone="warning">{t("smtpMissing")}</Badge>}
      </p>
      {error ? (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <ul className="mt-4 divide-y divide-line">
        {connections.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span>
              <Badge>{c.kind === "telegram" ? "Telegram" : "Confluence"}</Badge> <strong>{c.label}</strong>{" "}
              <span className="text-muted">
                {c.kind === "telegram" ? t("chat", { id: c.config.chatId ?? "" }) : t("space", { url: c.config.baseUrl ?? "", key: c.config.spaceKey ?? "" })} ·{" "}
                {c.secretHint}
              </span>
            </span>
            {canWrite ? (
              <span className="flex items-center gap-2">
                {c.kind === "telegram" ? (
                  <Button variant="ghost" disabled={busy} onClick={() => void toggleInbound(c)}>
                    {c.config.inboundEnabledAt ? t("inbound.disable") : t("inbound.enable")}
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void onDelete(c.id)}>
                  {t("delete")}
                </Button>
              </span>
            ) : null}
            {/* Questions over Telegram (06.11.26): the workspace's own bot answers in this private chat. */}
            {c.kind === "telegram" && c.config.inboundEnabledAt ? <p className="w-full text-xs text-success">{t("inbound.on")}</p> : null}
          </li>
        ))}
        {connections.length === 0 ? <li className="py-3 text-sm text-muted">{t("none")}</li> : null}
      </ul>
      {canWrite ? (
        <form onSubmit={(e) => void onAdd(e)} className="mt-4 grid gap-3 md:grid-cols-2">
          <SelectField label={t("type")} value={kind} onChange={(e) => setKind(e.target.value as "telegram" | "confluence")}>
            <option value="telegram">Telegram</option>
            <option value="confluence">Confluence (Atlassian Cloud)</option>
          </SelectField>
          <TextField
            label={t("name")}
            name="label"
            required
            maxLength={60}
            placeholder={kind === "telegram" ? t("namePlaceholderTelegram") : t("namePlaceholderConfluence")}
          />
          {kind === "telegram" ? (
            <>
              <TextField label={t("chatId")} name="chatId" required hint={t("chatIdHint")} />
              <PasswordField label={t("botToken")} name="secret" required autoComplete="off" hint={t("botTokenHint")} />
            </>
          ) : (
            <>
              <TextField label={t("siteUrl")} name="baseUrl" required placeholder="https://your-team.atlassian.net" />
              <TextField label={t("spaceKey")} name="spaceKey" required placeholder="DEC" />
              <TextField label={t("accountEmail")} name="email" type="email" required />
              <PasswordField label={t("apiToken")} name="secret" required autoComplete="off" hint={t("apiTokenHint")} />
            </>
          )}
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? t("saving") : t("saveConnection")}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

// Telegram and Confluence are product names; only "E-mail" is translated (settings.delivery.targetEmail).
const TARGET_LABEL = { telegram: "Telegram", confluence: "Confluence" } as const;

/**
 * Final Verdict → "Send to …" (#165): e-mail to members, Telegram or Confluence, with the project's default
 * preselected, and the history of sends with their status and a retry.
 */
export function SendDecision({
  sessionId,
  projectDefault,
}: {
  sessionId: string;
  projectDefault: { target: "email" | "telegram" | "confluence"; connectionId?: string | null; recipients?: string[] } | null;
}) {
  const [connections, setConnections] = useState<DeliveryConnectionView[]>([]);
  const [members, setMembers] = useState<Array<{ email: string; name: string }>>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [deliveries, setDeliveries] = useState<DeliveryView[]>([]);
  const [target, setTarget] = useState<"email" | "telegram" | "confluence">(projectDefault?.target ?? "email");
  const [connectionId, setConnectionId] = useState(projectDefault?.connectionId ?? "");
  const [recipients, setRecipients] = useState<string[]>(projectDefault?.recipients ?? []);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const t = useTranslations("settings.delivery");
  const format = useFormatter();
  const targetLabel = (to: "email" | "telegram" | "confluence") => (to === "email" ? t("targetEmail") : TARGET_LABEL[to]);

  async function reload() {
    const [c, d, m] = await Promise.all([
      fetchJson<{ connections: DeliveryConnectionView[]; emailConfigured: boolean }>("/api/delivery-connections"),
      fetchJson<{ deliveries: DeliveryView[] }>(`/api/sessions/${sessionId}/deliveries`),
      fetchJson<{ members: Array<{ email: string; name: string }> }>("/api/team/members"),
    ]);
    setMembers(m.members);
    setConnections(c.connections);
    setEmailConfigured(c.emailConfigured);
    setDeliveries(d.deliveries);
  }
  useEffect(() => {
    void reload().catch(() => undefined);
  }, [sessionId]);

  const ofKind = connections.filter((c) => c.kind === target);
  const ready = target === "email" ? emailConfigured && recipients.length > 0 : Boolean(connectionId && ofKind.some((c) => c.id === connectionId));

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fetchJson<{ status: "sent" | "failed"; error?: string; externalUrl?: string | null }>(`/api/sessions/${sessionId}/deliveries`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMessage(
        result.status === "sent"
          ? { tone: "success", text: result.externalUrl ? t("sentTo", { url: result.externalUrl }) : t("sent") }
          : { tone: "danger", text: t("notSent", { error: result.error ?? "" }) },
      );
      await reload();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiRequestError ? err.message : t("errorSend") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="font-semibold">{t("sendTitle")}</h3>
      <p className="text-sm text-muted">{t("sendText")}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SelectField label={t("target")} value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
          <option value="email">{emailConfigured ? t("emailOption") : t("emailOptionMissing")}</option>
          <option value="telegram">Telegram</option>
          <option value="confluence">Confluence</option>
        </SelectField>
        {target === "email" ? (
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium">{t("recipients")}</legend>
            {members.map((m) => (
              <label key={m.email} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={recipients.includes(m.email)}
                  onChange={(e) => setRecipients((current) => (e.target.checked ? [...current, m.email] : current.filter((r) => r !== m.email)))}
                />
                {m.name} <span className="text-muted">({m.email})</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <SelectField label={t("connection")} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            <option value="">{ofKind.length ? t("choose") : t("noneYet")}</option>
            {ofKind.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t("remember")}
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={busy || !ready} onClick={() => void send(target === "email" ? { target, recipients, remember } : { target, connectionId, remember })}>
          {busy ? t("sending") : t("sendVia", { target: targetLabel(target) })}
        </Button>
        {message ? (
          <span role="status" className={message.tone === "success" ? "text-sm text-success" : "text-sm text-danger"}>
            {message.text}
          </span>
        ) : null}
      </div>
      {deliveries.length ? (
        <ul className="mt-4 space-y-2 text-sm" aria-label={t("history")}>
          {deliveries.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={d.status === "sent" ? "success" : "danger"}>{d.status === "sent" ? t("statusSent") : t("statusFailed")}</Badge>
              <span>
                {targetLabel(d.target)} – {d.recipient}
              </span>
              <span className="text-muted">{format.dateTime(new Date(d.createdAt), { dateStyle: "medium", timeStyle: "short" })}</span>
              {d.externalUrl ? (
                <a className="text-primary underline" href={d.externalUrl} target="_blank" rel="noreferrer">
                  {t("open")}
                </a>
              ) : null}
              {d.status === "failed" ? (
                <>
                  <span className="text-muted">{d.error}</span>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        d.target === "email" ? { target: "email", recipients: d.recipient.split(", ") } : { target: d.target, connectionId: d.connectionId },
                      )
                    }
                  >
                    {t("retry")}
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
