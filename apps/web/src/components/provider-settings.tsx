"use client";

import { useState, type FormEvent } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField, TextField } from "./ui/field";
import { RotateKey } from "./saas";
import { Alert, Badge, Card, EmptyState } from "./ui/surface";

type Provider = "anthropic" | "openai" | "google" | "deepseek" | "glm" | "kimi" | "qwen" | "xai";

export interface CredentialView {
  id: string;
  provider: Provider;
  label: string;
  secretHint: string;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
}

interface ModelsResponse {
  credentials: { credentialId: string; provider: Provider; label: string; models: { modelId: string; displayName: string; contextWindow: number | null }[]; error: string | null }[];
}

const LABELS: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  google: "Google Gemini",
  deepseek: "DeepSeek",
  glm: "Z.ai (GLM)",
  kimi: "Moonshot (Kimi)",
  qwen: "Alibaba (Qwen)",
  xai: "xAI (Grok)",
};

// Pages where users create API keys in each provider's own console.
const KEY_PAGES: Record<Provider, string> = {
  anthropic: "https://platform.claude.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  deepseek: "https://platform.deepseek.com/api_keys",
  glm: "https://z.ai/manage-apikey/apikey-list",
  kimi: "https://platform.kimi.ai/console/api-keys",
  // Alibaba's key page depends on the region; the official guide links each region's console.
  qwen: "https://help.aliyun.com/en/model-studio/get-api-key",
  xai: "https://console.x.ai",
};

function KeyPageLinks() {
  return (
    <p className="text-sm text-muted">
      Need a key? Create one in the provider console:{" "}
      {(Object.keys(KEY_PAGES) as Provider[]).map((provider, index) => (
        <span key={provider}>
          {index > 0 ? " · " : null}
          <a href={KEY_PAGES[provider]} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {LABELS[provider]} ↗
          </a>
        </span>
      ))}
      . API usage is billed by the provider, separately from ChatGPT or Claude subscriptions.
    </p>
  );
}

export function ProviderSettings({ initial, canWrite, keysConfigured }: { initial: CredentialView[]; canWrite: boolean; keysConfigured: boolean }) {
  const [credentials, setCredentials] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);

  async function reload() {
    const { credentials } = await fetchJson<{ credentials: CredentialView[] }>("/api/credentials");
    setCredentials(credentials);
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy("add");
    setError(null);
    setNotice(null);
    try {
      await fetchJson("/api/credentials", {
        method: "POST",
        body: JSON.stringify({ provider: form.get("provider"), label: form.get("label") || "default", secret: form.get("secret") }),
      });
      formElement.reset();
      await reload();
      setNotice("Key stored encrypted. Use “Check” to verify it with the provider.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not store the key");
    } finally {
      setBusy(null);
    }
  }

  async function onValidate(id: string) {
    setBusy(id);
    setError(null);
    try {
      const result = await fetchJson<{ valid: boolean; modelCount?: number; error?: string }>(`/api/credentials/${id}/validate`, { method: "POST" });
      setNotice(result.valid ? `Key works: the provider reports ${result.modelCount} usable models.` : null);
      if (!result.valid) setError(`The provider rejected the key (${result.error}).`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Check failed");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(id: string) {
    setBusy(id);
    setError(null);
    try {
      await fetchJson(`/api/credentials/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not delete the key");
    } finally {
      setBusy(null);
    }
  }

  async function onLoadModels() {
    setBusy("models");
    setError(null);
    try {
      setModels(await fetchJson<ModelsResponse>("/api/models"));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load models");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {!keysConfigured ? (
        <Alert tone="warning">The server has no CREDENTIALS_MASTER_KEY configured, so API keys cannot be stored yet. See README → Local development.</Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {canWrite && keysConfigured ? (
        <Card>
          <h2 className="font-semibold">Add an API key</h2>
          <p className="mt-1 text-sm text-muted">Bring your own key. It is encrypted with AES-256-GCM before it is stored and is never shown again.</p>
          <form onSubmit={onAdd} className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
            <SelectField label="Provider" name="provider" defaultValue="anthropic">
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google Gemini</option>
              <option value="deepseek">DeepSeek</option>
              <option value="glm">Z.ai (GLM)</option>
              <option value="kimi">Moonshot (Kimi)</option>
              <option value="qwen">Alibaba (Qwen)</option>
              <option value="xai">xAI (Grok)</option>
            </SelectField>
            <TextField label="Label" name="label" placeholder="default" maxLength={60} />
            <TextField label="API key" name="secret" type="password" autoComplete="off" required minLength={10} />
            <Button type="submit" disabled={busy === "add"}>
              {busy === "add" ? "Saving…" : "Save key"}
            </Button>
          </form>
          <div className="mt-4">
            <KeyPageLinks />
          </div>
        </Card>
      ) : null}

      {credentials.length === 0 ? (
        <>
          <EmptyState title="No AI providers connected" description="Add at least one key so CONSYRION AI can discover which models your organization can use." />
          {!(canWrite && keysConfigured) ? <KeyPageLinks /> : null}
        </>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {credentials.map((credential) => (
              <li key={credential.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-medium">
                    {LABELS[credential.provider]} <span className="text-muted">· {credential.label}</span>
                  </p>
                  <p className="text-sm text-muted">{credential.secretHint}</p>
                </div>
                <div className="flex items-center gap-2">
                  {credential.lastValidatedAt ? (
                    credential.lastValidationError ? <Badge tone="danger">Check failed</Badge> : <Badge tone="success">Verified</Badge>
                  ) : (
                    <Badge>Not checked</Badge>
                  )}
                  <Button variant="secondary" onClick={() => onValidate(credential.id)} disabled={busy === credential.id}>
                    Check
                  </Button>
                  {canWrite ? <RotateKey id={credential.id} /> : null}
                  {canWrite ? (
                    <Button variant="danger" onClick={() => onDelete(credential.id)} disabled={busy === credential.id} aria-label={`Delete ${LABELS[credential.provider]} key ${credential.label}`}>
                      Delete
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {credentials.length > 0 ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Available models</h2>
              <p className="text-sm text-muted">Loaded live from each provider. Nothing in this list is hardcoded.</p>
            </div>
            <Button variant="secondary" onClick={onLoadModels} disabled={busy === "models"}>
              {busy === "models" ? "Loading…" : "Load models"}
            </Button>
          </div>
          {models ? (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {models.credentials.map((entry) => (
                <div key={entry.credentialId}>
                  <p className="mb-2 font-medium">
                    {LABELS[entry.provider]} <span className="text-muted">· {entry.label}</span>
                  </p>
                  {entry.error ? (
                    <p className="text-sm text-danger">{entry.error}</p>
                  ) : entry.models.length === 0 ? (
                    <p className="text-sm text-muted">No models reported.</p>
                  ) : (
                    <ul className="max-h-64 space-y-1 overflow-auto text-sm">
                      {entry.models.map((model) => (
                        <li key={model.modelId} className="truncate" title={model.modelId}>
                          {model.displayName}
                          {model.contextWindow ? <span className="text-muted"> · {Math.round(model.contextWindow / 1000)}k ctx</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
