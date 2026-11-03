"use client";

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
      setError(err instanceof ApiRequestError ? err.message : "Could not save the connection");
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
      setError(err instanceof ApiRequestError ? err.message : "Could not delete the connection");
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Send decisions</h2>
      <p className="text-sm text-muted">
        Where a verdict can go besides the PDF and Word download. Tokens are encrypted like your AI keys and never shown again. Obsidian follows with its own
        plugin (planned).
      </p>
      <p className="mt-2 text-sm">
        E-mail to workspace members:{" "}
        {emailConfigured ? <Badge tone="success">available</Badge> : <Badge tone="warning">not configured on this server (SMTP)</Badge>}
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
                {c.kind === "telegram" ? `chat ${c.config.chatId}` : `${c.config.baseUrl} · space ${c.config.spaceKey}`} · {c.secretHint}
              </span>
            </span>
            {canWrite ? (
              <Button variant="ghost" onClick={() => void onDelete(c.id)}>
                Delete
              </Button>
            ) : null}
          </li>
        ))}
        {connections.length === 0 ? <li className="py-3 text-sm text-muted">No connection yet.</li> : null}
      </ul>
      {canWrite ? (
        <form onSubmit={(e) => void onAdd(e)} className="mt-4 grid gap-3 md:grid-cols-2">
          <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as "telegram" | "confluence")}>
            <option value="telegram">Telegram</option>
            <option value="confluence">Confluence (Atlassian Cloud)</option>
          </SelectField>
          <TextField label="Name" name="label" required maxLength={60} placeholder={kind === "telegram" ? "Team chat" : "Decisions space"} />
          {kind === "telegram" ? (
            <>
              <TextField
                label="Chat id"
                name="chatId"
                required
                hint="The chat, group or channel the bot posts to, e.g. 123456789 or -100…; add the bot to it first."
              />
              <PasswordField label="Bot token" name="secret" required autoComplete="off" hint="From @BotFather – it stays encrypted on the server." />
            </>
          ) : (
            <>
              <TextField label="Site URL" name="baseUrl" required placeholder="https://your-team.atlassian.net" />
              <TextField label="Space key" name="spaceKey" required placeholder="DEC" />
              <TextField label="Account e-mail" name="email" type="email" required />
              <PasswordField label="API token" name="secret" required autoComplete="off" hint="id.atlassian.com → Security → API tokens." />
            </>
          )}
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save connection"}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

const TARGET_LABEL = { email: "E-mail", telegram: "Telegram", confluence: "Confluence" } as const;

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
          ? { tone: "success", text: result.externalUrl ? `Sent – ${result.externalUrl}` : "Sent." }
          : { tone: "danger", text: `Not sent: ${result.error}` },
      );
      await reload();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiRequestError ? err.message : "Could not send" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="font-semibold">Send to …</h3>
      <p className="text-sm text-muted">Take the decision where you work. The full report goes along as PDF (Confluence: as a page).</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SelectField label="Target" value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
          <option value="email">E-mail to workspace members{emailConfigured ? "" : " (not configured)"}</option>
          <option value="telegram">Telegram</option>
          <option value="confluence">Confluence</option>
        </SelectField>
        {target === "email" ? (
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium">Recipients</legend>
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
          <SelectField label="Connection" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            <option value="">{ofKind.length ? "Choose …" : "None yet – add one under Settings → Integrations"}</option>
            {ofKind.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Use this as the default for this project
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={busy || !ready} onClick={() => void send(target === "email" ? { target, recipients, remember } : { target, connectionId, remember })}>
          {busy ? "Sending…" : `Send via ${TARGET_LABEL[target]}`}
        </Button>
        {message ? (
          <span role="status" className={message.tone === "success" ? "text-sm text-success" : "text-sm text-danger"}>
            {message.text}
          </span>
        ) : null}
      </div>
      {deliveries.length ? (
        <ul className="mt-4 space-y-2 text-sm" aria-label="Sent so far">
          {deliveries.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={d.status === "sent" ? "success" : "danger"}>{d.status === "sent" ? "sent" : "failed"}</Badge>
              <span>
                {TARGET_LABEL[d.target]} – {d.recipient}
              </span>
              <span className="text-muted">{new Date(d.createdAt).toLocaleString("en-GB")}</span>
              {d.externalUrl ? (
                <a className="text-primary underline" href={d.externalUrl} target="_blank" rel="noreferrer">
                  open
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
                    Retry
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
