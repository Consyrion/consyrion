"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField, TextField } from "./ui/field";
import { Alert, Badge } from "./ui/surface";
import { Select } from "./ui/select";

function useAction() {
  const router = useRouter();
  const t = useTranslations("settings.saas");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, refresh = true) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (refresh) router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function UpgradeButton({ plan, label, disabled }: { plan: string; label: string; disabled?: boolean }) {
  const { busy, error, run } = useAction();
  const t = useTranslations("settings.saas");
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
        {busy ? t("redirecting") : label}
      </Button>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function PortalButton() {
  const { busy, error, run } = useAction();
  const t = useTranslations("settings.saas");
  return (
    <div>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void run(async () => (window.location.href = (await fetchJson<{ url: string }>("/api/billing/portal", { method: "POST" })).url), false)}
      >
        {t("manageSubscription")}
      </Button>
      {/* The server forgot a customer Stripe does not know (test mode → live, 07.11.26): explained in the interface language. */}
      {error ? (
        <p className="mt-1 text-xs text-danger">
          {error.startsWith("This subscription does not exist in the connected Stripe account") ? t("portalStaleCustomer") : error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Back to the free plan: opens Stripe's customer portal directly at the cancellation step. The portal cancels at the
 * period end (portal configuration, #337), so the paid month stays usable and the billing page shows "ends on".
 */
export function DowngradeButton({ label }: { label: string }) {
  const { busy, error, run } = useAction();
  const t = useTranslations("settings.saas");
  return (
    <div>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          void run(
            async () =>
              (window.location.href = (
                await fetchJson<{ url: string }>("/api/billing/portal", { method: "POST", body: JSON.stringify({ flow: "cancel" }) })
              ).url),
            false,
          )
        }
      >
        {label}
      </Button>
      {error ? (
        <p className="mt-1 text-xs text-danger">
          {error.startsWith("This subscription does not exist in the connected Stripe account") ? t("portalStaleCustomer") : error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * After returning from Stripe (checkout or customer portal) the webhook often arrives a few seconds later. The server
 * renders this only while the expected change is not stored yet; it refreshes the page – and with it the app layout,
 * which client navigation does not re-render (sidebar upgrade entry) – every 2 seconds for at most 30 seconds.
 */
export function RefreshUntilSettled({ intervalMs = 2000, maxMs = 30_000 }: { intervalMs?: number; maxMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > maxMs) clearInterval(timer);
      else router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs, maxMs]);
  return null;
}

export function PriceHintForm() {
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ provider: "anthropic", modelId: "", inputPerMillion: "", outputPerMillion: "", currency: "USD" });
  const t = useTranslations("settings.saas");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-2">
      <div className="grid gap-3 md:grid-cols-5">
        <SelectField label={t("provider")} value={form.provider} onChange={set("provider")}>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="google">Google Gemini</option>
          <option value="deepseek">DeepSeek</option>
          <option value="glm">Z.ai (GLM)</option>
          <option value="kimi">Moonshot (Kimi)</option>
          <option value="qwen">Alibaba (Qwen)</option>
          <option value="xai">xAI (Grok)</option>
        </SelectField>
        <TextField label={t("modelId")} value={form.modelId} onChange={set("modelId")} />
        <TextField label={t("inputPrice")} value={form.inputPerMillion} onChange={set("inputPerMillion")} inputMode="decimal" />
        <TextField label={t("outputPrice")} value={form.outputPerMillion} onChange={set("outputPerMillion")} inputMode="decimal" />
        <TextField label={t("currency")} value={form.currency} onChange={set("currency")} maxLength={3} />
      </div>
      <Button
        variant="secondary"
        disabled={busy || !form.modelId}
        onClick={() => void run(() => fetchJson("/api/pricing", { method: "POST", body: JSON.stringify(form) }))}
      >
        {t("savePrice")}
      </Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

export function DeleteHint({ id }: { id: string }) {
  const { busy, run } = useAction();
  const t = useTranslations("settings.saas");
  return (
    <Button variant="ghost" disabled={busy} onClick={() => void run(() => fetchJson(`/api/pricing/${id}`, { method: "DELETE" }))}>
      {t("remove")}
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

export function TeamManager({
  members,
  invitations,
  canManage,
  currentUserId,
}: {
  members: Member[];
  invitations: Array<{ id: string; email: string; role: string; expiresAt: string }>;
  canManage: boolean;
  currentUserId: string;
}) {
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const t = useTranslations("settings.saas");
  const format = useFormatter();
  const roleLabel = (r: string) => (t.has(`roles.${r}`) ? t(`roles.${r}`) : r);
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
                  aria-label={t("roleOf", { name: m.name })}
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => void run(() => fetchJson(`/api/team/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }))}
                  className="min-w-32"
                >
                  {["owner", "admin", "member", "viewer"].map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge>{roleLabel(m.role)}</Badge>
              )}
              {(canManage && m.userId !== currentUserId) || m.userId === currentUserId ? (
                <Button variant="ghost" disabled={busy} onClick={() => void run(() => fetchJson(`/api/team/members/${m.id}`, { method: "DELETE" }))}>
                  {m.userId === currentUserId ? t("leave") : t("remove")}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {canManage ? (
        <div className="space-y-3">
          <h2 className="font-semibold">{t("inviteTitle")}</h2>
          {/* The address gets the full width; role and button sit next to it (stacked on phones). */}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
            <TextField
              label={t("email")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="off"
            />
            <SelectField label={t("role")} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">{roleLabel("admin")}</option>
              <option value="member">{roleLabel("member")}</option>
              <option value="viewer">{roleLabel("viewer")}</option>
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
              {t("createInvite")}
            </Button>
          </div>
          {link ? (
            <Alert tone="success">
              <p>{t("shareLink")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 rounded-lg border border-glass-line bg-surface px-3 py-2 break-all">{link}</code>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link).then(() => setCopied(true));
                  }}
                >
                  {copied ? t("copied") : t("copyLink")}
                </Button>
              </div>
            </Alert>
          ) : null}
          {invitations.length ? (
            <ul className="space-y-1 text-sm">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center justify-between">
                  <span>
                    {i.email} · {roleLabel(i.role)} · {t("expires", { date: format.dateTime(new Date(i.expiresAt), { dateStyle: "medium" }) })}
                  </span>
                  <Button variant="ghost" disabled={busy} onClick={() => void run(() => fetchJson(`/api/team/invitations/${i.id}`, { method: "DELETE" }))}>
                    {t("revoke")}
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
  const t = useTranslations("settings.saas");
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
        {t("acceptInvitation")}
      </Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

export function WorkspaceSwitcher({ organizations, active }: { organizations: Array<{ id: string; name: string; role: string }>; active: string }) {
  const { busy, error, run } = useAction();
  const t = useTranslations("settings.saas");
  return (
    <div>
      <SelectField
        label={t("activeWorkspace")}
        value={active}
        disabled={busy}
        onChange={(e) => void run(() => fetchJson("/api/orgs/active", { method: "POST", body: JSON.stringify({ organizationId: e.target.value }) }))}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({t.has(`roles.${o.role}`) ? t(`roles.${o.role}`) : o.role})
          </option>
        ))}
      </SelectField>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

/** Irreversible deletion that requires typing the exact name. */
export function DangerDelete({
  url,
  method,
  name,
  label,
  redirectTo,
}: {
  url: string;
  method: "POST" | "DELETE";
  name: string;
  label: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [confirm, setConfirm] = useState("");
  const t = useTranslations("settings.saas");
  return (
    <div className="space-y-2">
      <TextField label={t("typeToConfirm", { name })} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
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
  const t = useTranslations("settings.saas");
  return (
    <span>
      <Select
        aria-label={t("plan")}
        value={plan}
        disabled={busy}
        onChange={(e) =>
          void run(() => fetchJson(`/api/admin/organizations/${organizationId}/plan`, { method: "PUT", body: JSON.stringify({ plan: e.target.value }) }))
        }
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

export function AdminPlanEditor({
  plan,
}: {
  plan: { key: string; name: string; entitlements: Record<string, number | boolean>; priceLabel: string | null; stripePriceId: string | null; active: boolean };
}) {
  const { busy, error, run } = useAction();
  const [state, setState] = useState(plan);
  const t = useTranslations("settings.saas");
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <TextField label={t("name")} value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
        <TextField
          label={t("priceLabel")}
          value={state.priceLabel ?? ""}
          onChange={(e) => setState({ ...state, priceLabel: e.target.value })}
          placeholder={t("priceLabelPlaceholder")}
        />
        <TextField label={t("stripePriceId")} value={state.stripePriceId ?? ""} onChange={(e) => setState({ ...state, stripePriceId: e.target.value })} />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={state.active} onChange={(e) => setState({ ...state, active: e.target.checked })} /> {t("active")}
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {Object.entries(state.entitlements).map(([key, value]) =>
          typeof value === "boolean" ? (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => setState({ ...state, entitlements: { ...state.entitlements, [key]: e.target.checked } })}
              />{" "}
              {key}
            </label>
          ) : (
            <TextField
              key={key}
              label={key}
              type="number"
              min={0}
              value={String(value)}
              onChange={(e) => setState({ ...state, entitlements: { ...state.entitlements, [key]: Number(e.target.value) } })}
            />
          ),
        )}
      </div>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void run(() => fetchJson(`/api/admin/plans/${plan.key}`, { method: "PUT", body: JSON.stringify(state) }))}
      >
        {t("savePlan", { plan: plan.key })}
      </Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

export function RotateKey({ id }: { id: string }) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const t = useTranslations("settings.saas");
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("rotate")}
      </Button>
    );
  return (
    <span className="flex flex-wrap items-end gap-2">
      <TextField label={t("newApiKey")} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
      <Button
        disabled={busy || secret.length < 10}
        onClick={() =>
          void run(
            async () => (await fetchJson(`/api/credentials/${id}/rotate`, { method: "POST", body: JSON.stringify({ secret }) }), setOpen(false), setSecret("")),
          )
        }
      >
        {t("save")}
      </Button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}

/** /admin → Stripe: paste the secret key once; product, monthly price, webhook and portal are created at Stripe. */
export function AdminStripeSetup({
  status,
}: {
  status: { connected: boolean; fromEnv: boolean; mode?: string; keyHint?: string; priceId?: string; amountCents?: number };
}) {
  const { busy, error, run } = useAction();
  const [secretKey, setSecretKey] = useState("");
  const [amount, setAmount] = useState(((status.amountCents ?? 499) / 100).toFixed(2));
  const [done, setDone] = useState<string | null>(null);
  const t = useTranslations("settings.saas.stripe");
  const format = useFormatter();
  // Prices are shown with two decimals, the way they are entered.
  const euros = (cents: number) => format.number(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="space-y-3">
      <p className="text-sm">
        {status.connected ? (
          <>
            <Badge tone={status.mode === "live" ? "success" : "warning"}>{status.mode === "live" ? t("live") : t("testMode")}</Badge>{" "}
            {t("connected", { key: status.keyHint ?? "", price: euros(status.amountCents ?? 0) })} · <code>{status.priceId}</code>
          </>
        ) : status.fromEnv ? (
          t("fromEnv")
        ) : (
          t("notConnected")
        )}
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <TextField
          label={status.connected ? t("newSecretKey") : t("secretKey")}
          type="password"
          autoComplete="off"
          placeholder={t("secretKeyPlaceholder")}
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
        />
        <TextField label={t("priceField")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="self-end">
          <Button
            disabled={busy || (!status.connected && secretKey.length < 10)}
            onClick={() =>
              void run(async () => {
                const r = await fetchJson<{ mode: string; amountCents: number }>("/api/admin/stripe", {
                  method: "POST",
                  body: JSON.stringify({ secretKey: secretKey || undefined, amount }),
                });
                setSecretKey("");
                setDone(t("saved", { mode: r.mode, price: euros(r.amountCents) }));
              })
            }
          >
            {busy ? t("talking") : status.connected ? t("save") : t("connect")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted">{t("help")}</p>
      {done ? <Alert tone="success">{done}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
