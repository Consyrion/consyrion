"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField, TextField } from "./ui/field";
import { Alert } from "./ui/surface";

export function ApiTokens({
  tokens,
  mcp,
}: {
  tokens: Array<{ id: string; name: string; prefix: string; scope: string; lastUsedAt: string | null; expiresAt: string }>;
  /** MCP server address and whether the workspace's plan includes it. */
  mcp: { url: string; allowed: boolean };
}) {
  const router = useRouter();
  const t = useTranslations("settings.apiTokens");
  const format = useFormatter();
  const scopeLabel = (scope: string) => (t.has(`scope.${scope}`) ? t(`scope.${scope}`) : scope);
  const [name, setName] = useState(() => t("defaultName"));
  const [scope, setScope] = useState<"read" | "integration" | "full">("integration");
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
      setError(err instanceof ApiRequestError ? err.message : t("errorCreate"));
    }
  }
  async function revoke(id: string) {
    await fetchJson(`/api/tokens/${id}`, { method: "DELETE" }).catch(() => undefined);
    router.refresh();
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <TextField label={t("name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <TextField label={t("validDays")} type="number" min={1} max={365} value={String(days)} onChange={(e) => setDays(Number(e.target.value))} />
        <SelectField
          label={t("access")}
          value={scope}
          onChange={(e) => setScope(e.target.value === "full" ? "full" : e.target.value === "read" ? "read" : "integration")}
        >
          <option value="read">{scopeLabel("read")}</option>
          <option value="integration">{scopeLabel("integration")}</option>
          <option value="full">{scopeLabel("full")}</option>
        </SelectField>
        <Button onClick={() => void create()}>{t("create")}</Button>
      </div>
      {created ? (
        <Alert tone="success">
          {t("copyNow")} <code className="break-all">{created}</code>
        </Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {/* MCP server (06.11.26): connect Claude Code, Cursor, VS Code … with one of these tokens – Pro and up. */}
      <div className="rounded-xl border border-line bg-surface p-4 text-sm">
        <p className="font-medium">{t("mcp.title")}</p>
        {mcp.allowed ? (
          <>
            <p className="mt-1 text-muted">{t("mcp.intro")}</p>
            <p className="mt-2 text-xs text-muted">{t("mcp.address")}</p>
            <code className="block break-all rounded-lg bg-surface-2 px-2 py-1 text-xs">{mcp.url}</code>
            <p className="mt-2 text-xs text-muted">{t("mcp.claudeCode")}</p>
            <code className="block break-all rounded-lg bg-surface-2 px-2 py-1 text-xs">{`claude mcp add --transport http consyrium ${mcp.url} --header "Authorization: Bearer <TOKEN>"`}</code>
            <p className="mt-2 text-xs text-muted">{t("mcp.scopes")}</p>
          </>
        ) : (
          <p className="mt-1 text-muted">{t("mcp.proOnly")}</p>
        )}
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {tokens.length === 0 ? <li className="px-4 py-3 text-sm text-muted">{t("none")}</li> : null}
        {tokens.map((token) => (
          <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span>
              <strong>{token.name}</strong> <code className="text-muted">{token.prefix}…</code>
              <span className="block text-xs text-muted">{scopeLabel(token.scope)}</span>
              <span className="block text-xs text-muted">
                {t("expires", { date: format.dateTime(new Date(token.expiresAt), { dateStyle: "medium" }) })} ·{" "}
                {t("lastUsed", {
                  date: token.lastUsedAt ? format.dateTime(new Date(token.lastUsedAt), { dateStyle: "medium", timeStyle: "short" }) : t("never"),
                })}
              </span>
            </span>
            <Button variant="danger" onClick={() => void revoke(token.id)}>
              {t("revoke")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
