"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField, TextAreaField } from "./ui/field";
import { Alert, Badge } from "./ui/surface";

interface Doc {
  id: string;
  name: string;
  sizeBytes: number;
  /** Images only (docs/documents.md). */
  descriptionStatus?: "pending" | "draft" | "confirmed" | string | null;
  describedBy?: string | null;
  description?: string | null;
}

const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
/** Badge tone per image description status; the text comes from `documents.status.<status>`. */
const STATUS: Record<string, "warning" | "success"> = { pending: "warning", draft: "warning", confirmed: "success" };

/** Documents attached to a project (text, the text of a PDF/Word/PowerPoint file, or the confirmed description of an image). */
export function DocumentUpload({ projectId, initial, canWrite }: { projectId: string; initial: Doc[]; canWrite: boolean }) {
  const t = useTranslations("documents");
  const [documents, setDocuments] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(`${file.name}: ${json?.error?.message ?? t("uploadFailed")}`);
        break;
      }
      setDocuments((d) => [...d, json.document]);
    }
    setBusy(false);
  }

  async function remove(id: string) {
    try {
      await fetchJson(`/api/projects/${projectId}/documents/${id}`, { method: "DELETE" });
      setDocuments((d) => d.filter((x) => x.id !== id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("deleteError"));
    }
  }

  const update = (id: string, patch: Partial<Doc>) => setDocuments((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-3">
      {documents.length === 0 ? <p className="text-sm text-muted">{t("none")}</p> : null}
      <ul className="space-y-2">
        {documents.map((doc) => (
          <li key={doc.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{doc.name}</span>
                {doc.descriptionStatus && STATUS[doc.descriptionStatus] ? (
                  <Badge tone={STATUS[doc.descriptionStatus]!}>{t(`status.${doc.descriptionStatus}`)}</Badge>
                ) : null}
              </span>
              <span className="flex items-center gap-3 text-muted">
                {doc.descriptionStatus ? null : t("size", { kb: (doc.sizeBytes / 1000).toFixed(1) })}
                {canWrite ? (
                  <Button variant="ghost" className="px-2 py-1" onClick={() => void remove(doc.id)} aria-label={t("removeLabel", { name: doc.name })}>
                    {t("remove")}
                  </Button>
                ) : null}
              </span>
            </div>
            {doc.descriptionStatus && canWrite ? <ImageDescription projectId={projectId} doc={doc} onChange={(patch) => update(doc.id, patch)} /> : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        <label className="block">
          <span className="sr-only">{t("upload")}</span>
          <input
            type="file"
            multiple
            disabled={busy}
            accept={`.pdf,.docx,.pptx,${IMAGE_ACCEPT},.md,.markdown,.txt,.json,.yaml,.yml,.csv,.xml,.html,.ts,.tsx,.js,.jsx,.py,.java,.kt,.go,.rs,.rb,.php,.cs,.sql,.sh,.toml,.ini`}
            onChange={(event) => void upload(event.target.files)}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-text hover:file:border-primary"
          />
          <span className="mt-1 block text-xs text-muted">
            {t("formats")}
          </span>
        </label>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}

interface CredentialModels {
  credentialId: string;
  provider: string;
  label: string | null;
  models: Array<{ modelId: string; displayName: string }>;
}

/** Describe an image with one model (paid call on the user's key), review the draft, confirm it. */
function ImageDescription({ projectId, doc, onChange }: { projectId: string; doc: Doc; onChange: (patch: Partial<Doc>) => void }) {
  const t = useTranslations("documents");
  const [text, setText] = useState(doc.description ?? "");
  const [models, setModels] = useState<CredentialModels[] | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/projects/${projectId}/documents/${doc.id}`;

  async function loadModels() {
    setError(null);
    try {
      const result = await fetchJson<{ credentials: CredentialModels[] }>("/api/models");
      // DeepSeek has no image input; every other provider offers image-capable models (the call fails clearly otherwise).
      setModels(result.credentials.filter((c) => c.provider !== "deepseek" && c.models.length));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("modelsError"));
    }
  }

  async function describe() {
    const [credentialId, modelId] = choice.split("|");
    if (!credentialId || !modelId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchJson<{ description: string; describedBy: string }>(`${base}/describe`, {
        method: "POST",
        body: JSON.stringify({ credentialId, modelId }),
      });
      setText(result.description);
      onChange({ descriptionStatus: "draft", describedBy: result.describedBy, description: result.description });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("describeError"));
    }
    setBusy(false);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`${base}/description`, { method: "PUT", body: JSON.stringify({ text }) });
      onChange({ descriptionStatus: "confirmed", description: text.trim() });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("confirmError"));
    }
    setBusy(false);
  }

  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      {doc.descriptionStatus !== "confirmed" ? (
        <p className="text-xs text-muted">
          {t("imageIntro")}
        </p>
      ) : null}
      {models === null ? (
        <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => void loadModels()} disabled={busy}>
          {t("describeWith")}
        </Button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label={t("model")} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{t("chooseModel")}</option>
            {models.flatMap((c) =>
              c.models.map((m) => (
                <option key={`${c.credentialId}|${m.modelId}`} value={`${c.credentialId}|${m.modelId}`}>
                  {m.displayName} ({c.label ?? c.provider})
                </option>
              )),
            )}
          </SelectField>
          <Button className="px-3 py-1 text-xs" onClick={() => void describe()} disabled={busy || !choice}>
            {busy ? t("describing") : t("describe")}
          </Button>
        </div>
      )}
      <TextAreaField
        label={doc.describedBy ? t("descriptionBy", { model: doc.describedBy }) : t("description")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        maxLength={20_000}
      />
      <Button className="px-3 py-1 text-xs" onClick={() => void confirm()} disabled={busy || text.trim().length < 20}>
        {doc.descriptionStatus === "confirmed" ? t("saveChanged") : t("confirm")}
      </Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
