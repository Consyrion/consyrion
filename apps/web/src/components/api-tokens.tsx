"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField, TextField } from "./ui/field";
import { Alert } from "./ui/surface";

const SCOPE_LABEL: Record<string, string> = {
  integration: "Councils only – start, read, cancel; no approvals or builds",
  full: "Full access – also approvals and builds (VS Code)",
};

export function ApiTokens({ tokens }: { tokens: Array<{ id: string; name: string; prefix: string; scope: string; lastUsedAt: string | null; expiresAt: string }> }) {
  const router = useRouter();
  const [name, setName] = useState("Integration");
  const [scope, setScope] = useState<"integration" | "full">("integration");
  const [days, setDays] = useState(90);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setError(null);
    try {
      const result = await fetchJson<{ token: string }>("/api/tokens", { method: "POST", body: JSON.stringify({ name, days, scope }) });
      setCreated(result.token);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not create the token");
    }
  }
  async function revoke(id: string) {
    await fetchJson(`/api/tokens/${id}`, { method: "DELETE" }).catch(() => undefined);
    router.refresh();
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <TextField label="Valid for (days)" type="number" min={1} max={365} value={String(days)} onChange={(e) => setDays(Number(e.target.value))} />
        <SelectField label="Access" value={scope} onChange={(e) => setScope(e.target.value === "full" ? "full" : "integration")}>
          <option value="integration">{SCOPE_LABEL.integration}</option>
          <option value="full">{SCOPE_LABEL.full}</option>
        </SelectField>
        <Button onClick={() => void create()}>Create token</Button>
      </div>
      {created ? (
        <Alert tone="success">
          Copy this token now – it is shown only once: <code className="break-all">{created}</code>
        </Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {tokens.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No tokens.</li> : null}
        {tokens.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span>
              <strong>{t.name}</strong> <code className="text-muted">{t.prefix}…</code>
              <span className="block text-xs text-muted">{SCOPE_LABEL[t.scope] ?? t.scope}</span>
              <span className="block text-xs text-muted">
                expires {new Date(t.expiresAt).toLocaleDateString("en-GB")} · last used {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString("en-GB") : "never"}
              </span>
            </span>
            <Button variant="danger" onClick={() => void revoke(t.id)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
