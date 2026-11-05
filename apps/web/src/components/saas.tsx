"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField, TextField } from "./ui/field";
import { Alert, Badge } from "./ui/surface";
import { Select } from "./ui/select";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, refresh = true) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (refresh) router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function UpgradeButton({ plan, label, disabled }: { plan: string; label: string; disabled?: boolean }) {
  const { busy, error, run } = useAction();
  return (
    <div>
      <Button
        disabled={busy || disabled}
        onClick={() =>
          void run(async () => {
            const { url } = await fetchJson<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
            window.location.href = url;
          }, false)
        }
      >
        {busy ? "Redirecting…" : label}
      </Button>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function PortalButton() {
  const { busy, error, run } = useAction();
  return (
    <div>
      <Button variant="secondary" disabled={busy} onClick={() => void run(async () => (window.location.href = (await fetchJson<{ url: string }>("/api/billing/portal", { method: "POST" })).url), false)}>
        Manage subscription
      </Button>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function PriceHintForm() {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ provider: "anthropic", modelId: "", inputPerMillion: "", outputPerMillion: "", currency: "USD" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-2">
      <div className="grid gap-3 md:grid-cols-5">
        <SelectField label="Provider" value={form.provider} onChange={set("provider")}>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="google">Google Gemini</option>
          <option value="deepseek">DeepSeek</option>
          <option value="glm">Z.ai (GLM)</option>
          <option value="kimi">Moonshot (Kimi)</option>
          <option value="qwen">Alibaba (Qwen)</option>
          <option value="xai">xAI (Grok)</option>
        </SelectField>
        <TextField label="Model id" value={form.modelId} onChange={set("modelId")} />
        <TextField label="Input / 1M tokens" value={form.inputPerMillion} onChange={set("inputPerMillion")} inputMode="decimal" />
        <TextField label="Output / 1M tokens" value={form.outputPerMillion} onChange={set("outputPerMillion")} inputMode="decimal" />
        <TextField label="Currency" value={form.currency} onChange={set("currency")} maxLength={3} />
      </div>
      <Button variant="secondary" disabled={busy || !form.modelId} onClick={() => void run(() => fetchJson("/api/pricing", { method: "POST", body: JSON.stringify(form) }))}>
        Save price
      </Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

export function DeleteHint({ id }: { id: string }) {
  const { busy, run } = useAction();
  return (
    <Button variant="ghost" disabled={busy} onClick={() => void run(() => fetchJson(`/api/pricing/${id}`, { method: "DELETE" }))}>
      Remove
    </Button>
  );
}

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  userId: string;
}

export function TeamManager({ members, invitations, canManage, currentUserId }: { members: Member[]; invitations: Array<{ id: string; email: string; role: string; expiresAt: string }>; canManage: boolean; currentUserId: string }) {
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-6">
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <span>
              <strong>{m.name}</strong> <span className="text-muted">{m.email}</span>
            </span>
            <span className="flex items-center gap-2">
              {canManage && m.userId !== currentUserId ? (
                <Select
                  aria-label={`Role of ${m.name}`}
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => void run(() => fetchJson(`/api/team/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }))}
                  className="min-w-32"
                >
                  {["owner", "admin", "member", "viewer"].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge>{m.role}</Badge>
              )}
              {(canManage && m.userId !== currentUserId) || m.userId === currentUserId ? (
                <Button variant="ghost" disabled={busy} onClick={() => void run(() => fetchJson(`/api/team/members/${m.id}`, { method: "DELETE" }))}>
                  {m.userId === currentUserId ? "Leave" : "Remove"}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {canManage ? (
        <div className="space-y-3">
          <h2 className="font-semibold">Invite someone</h2>
          {/* The address gets the full width; role and button sit next to it (stacked on phones). */}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
            <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" />
            <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">admin</option>
              <option value="member">member</option>
              <option value="viewer">viewer</option>
            </SelectField>
            <Button
              disabled={busy || !email}
              onClick={() =>
                void run(async () => {
                  const result = await fetchJson<{ link: string }>("/api/team/members", { method: "POST", body: JSON.stringify({ email, role }) });
                  setLink(result.link);
                  setCopied(false);
                  setEmail("");
                })
              }
            >
              Create invitation link
            </Button>
          </div>
          {link ? (
            <Alert tone="success">
              <p>Share this link with the invited person (shown only once, valid 7 days):</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 rounded-lg border border-glass-line bg-surface px-3 py-2 break-all">{link}</code>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link).then(() => setCopied(true));
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            </Alert>
          ) : null}
          {invitations.length ? (
            <ul className="space-y-1 text-sm">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center justify-between">
                  <span>
                    {i.email} · {i.role} · expires {new Date(i.expiresAt).toLocaleDateString("en-GB")}
                  </span>
                  <Button variant="ghost" disabled={busy} onClick={() => void run(() => fetchJson(`/api/team/invitations/${i.id}`, { method: "DELETE" }))}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <div className="space-y-3">
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await fetchJson("/api/invitations/accept", { method: "POST", body: JSON.stringify({ token }) });
            router.push("/dashboard");
          }, false)
        }
      >
        Accept invitation
      </Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

export function WorkspaceSwitcher({ organizations, active }: { organizations: Array<{ id: string; name: string; role: string }>; active: string }) {
  const { busy, error, run } = useAction();
  return (
    <div>
      <SelectField label="Active workspace" value={active} disabled={busy} onChange={(e) => void run(() => fetchJson("/api/orgs/active", { method: "POST", body: JSON.stringify({ organizationId: e.target.value }) }))}>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.role})
          </option>
        ))}
      </SelectField>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

/** Irreversible deletion that requires typing the exact name. */
export function DangerDelete({ url, method, name, label, redirectTo }: { url: string; method: "POST" | "DELETE"; name: string; label: string; redirectTo: string }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [confirm, setConfirm] = useState("");
  return (
    <div className="space-y-2">
      <TextField label={`Type “${name}” to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <Button
        variant="danger"
        disabled={busy || confirm !== name}
        onClick={() =>
          void run(async () => {
            await fetchJson(url, { method, body: JSON.stringify({ confirmName: confirm }) });
            router.push(redirectTo);
            router.refresh();
          }, false)
        }
      >
        {label}
      </Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

export function AdminPlanSelect({ organizationId, plan }: { organizationId: string; plan: string }) {
  const { busy, error, run } = useAction();
  return (
    <span>
      <Select
        aria-label="Plan"
        value={plan}
        disabled={busy}
        onChange={(e) => void run(() => fetchJson(`/api/admin/organizations/${organizationId}/plan`, { method: "PUT", body: JSON.stringify({ plan: e.target.value }) }))}
        className="inline-block min-w-36"
      >
        {["starter", "pro", "developer", "business"].map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      {error ? <span className="ml-2 text-xs text-danger">{error}</span> : null}
    </span>
  );
}

export function AdminPlanEditor({ plan }: { plan: { key: string; name: string; entitlements: Record<string, number | boolean>; priceLabel: string | null; stripePriceId: string | null; active: boolean } }) {
  const { busy, error, run } = useAction();
  const [state, setState] = useState(plan);
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <TextField label="Name" value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
        <TextField label="Price label" value={state.priceLabel ?? ""} onChange={(e) => setState({ ...state, priceLabel: e.target.value })} placeholder="e.g. CHF 29 / month" />
        <TextField label="Stripe price id" value={state.stripePriceId ?? ""} onChange={(e) => setState({ ...state, stripePriceId: e.target.value })} />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={state.active} onChange={(e) => setState({ ...state, active: e.target.checked })} /> active
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {Object.entries(state.entitlements).map(([key, value]) =>
          typeof value === "boolean" ? (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={value} onChange={(e) => setState({ ...state, entitlements: { ...state.entitlements, [key]: e.target.checked } })} /> {key}
            </label>
          ) : (
            <TextField key={key} label={key} type="number" min={0} value={String(value)} onChange={(e) => setState({ ...state, entitlements: { ...state.entitlements, [key]: Number(e.target.value) } })} />
          ),
        )}
      </div>
      <Button variant="secondary" disabled={busy} onClick={() => void run(() => fetchJson(`/api/admin/plans/${plan.key}`, { method: "PUT", body: JSON.stringify(state) }))}>
        Save {plan.key}
      </Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

export function RotateKey({ id }: { id: string }) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Rotate
      </Button>
    );
  return (
    <span className="flex flex-wrap items-end gap-2">
      <TextField label="New API key" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
      <Button disabled={busy || secret.length < 10} onClick={() => void run(async () => (await fetchJson(`/api/credentials/${id}/rotate`, { method: "POST", body: JSON.stringify({ secret }) }), setOpen(false), setSecret("")))}>
        Save
      </Button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}

/** /admin → Stripe: paste the secret key once; product, monthly price, webhook and portal are created at Stripe. */
export function AdminStripeSetup({ status }: { status: { connected: boolean; fromEnv: boolean; mode?: string; keyHint?: string; priceId?: string; amountCents?: number } }) {
  const { busy, error, run } = useAction();
  const [secretKey, setSecretKey] = useState("");
  const [amount, setAmount] = useState(((status.amountCents ?? 499) / 100).toFixed(2));
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm">
        {status.connected ? (
          <>
            <Badge tone={status.mode === "live" ? "success" : "warning"}>{status.mode === "live" ? "live" : "test mode"}</Badge> Connected with key {status.keyHint} · Pro price{" "}
            {((status.amountCents ?? 0) / 100).toFixed(2)} € / month (VAT incl.) · <code>{status.priceId}</code>
          </>
        ) : status.fromEnv ? (
          "Configured through STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET in the environment. Paste a key below to manage it here instead."
        ) : (
          "Not connected – nobody can buy Pro yet."
        )}
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <TextField
          label={status.connected ? "New secret key (optional)" : "Stripe secret key"}
          type="password"
          autoComplete="off"
          placeholder="sk_test_… or sk_live_…"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
        />
        <TextField label="Pro price per month in € (VAT incl.)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="self-end">
          <Button
            disabled={busy || (!status.connected && secretKey.length < 10)}
            onClick={() =>
              void run(async () => {
                const r = await fetchJson<{ mode: string; amountCents: number }>("/api/admin/stripe", { method: "POST", body: JSON.stringify({ secretKey: secretKey || undefined, amount }) });
                setSecretKey("");
                setDone(`Saved (${r.mode}): Pro costs ${(r.amountCents / 100).toFixed(2)} € / month.`);
              })
            }
          >
            {busy ? "Talking to Stripe…" : status.connected ? "Save" : "Connect Stripe"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted">
        Stripe dashboard → Developers → API keys → secret key. The key is stored encrypted and never shown again. A new price creates a new Stripe price; running
        subscriptions keep theirs.
      </p>
      {done ? <Alert tone="success">{done}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
