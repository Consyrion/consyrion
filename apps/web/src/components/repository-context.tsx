"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { Alert, Badge } from "./ui/surface";

/** The saved repository context (one generated document) as shown above the file list (#242). */
export interface SavedContext {
  id: string;
  sizeBytes: number;
  repository: string;
  branch: string;
  commitSha: string;
  paths: string[];
}

interface Listing {
  repository: string;
  branch: string;
  commitSha: string;
  files: Array<{ path: string; size: number }>;
  suggested: string[];
  limits: { maxTotalBytes: number; maxFiles: number };
  current: { id: string; name: string; sizeBytes: number; origin: { commitSha: string; paths: string[] } | null } | null;
}

const kB = (bytes: number) => `${Math.max(1, Math.round(bytes / 1000))} kB`;
/** About four characters per token – the same rough rate as the cost preview. */
const tokens = (bytes: number) => Math.round(bytes / 4);

/**
 * Repository context for Decision councils (docs/documents.md): the user chooses which files of the linked repository
 * the models read. #242: the saved state is shown at the top (commit, files, size, tokens per call) with Change and
 * Remove; saving asks first, because the requirements must be confirmed again; a newer commit is pointed out; success
 * and errors appear next to the button and the list closes after saving.
 */
export function RepositoryContext({ projectId, canWrite, initial = null }: { projectId: string; canWrite: boolean; initial?: SavedContext | null }) {
  const t = useTranslations("repoContext");
  const format = useFormatter();
  const router = useRouter();
  const [saved, setSaved] = useState<SavedContext | null>(initial);
  const [listing, setListing] = useState<Listing | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"save" | "remove" | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await fetchJson<Listing>(`/api/projects/${projectId}/repository/context`);
      setListing(data);
      // Keep the saved choice (also on a newer commit, as far as the files still exist); otherwise the suggestion.
      const savedPaths = saved?.paths ?? data.current?.origin?.paths ?? null;
      const existing = new Set(data.files.map((f) => f.path));
      setChosen(new Set(savedPaths ? savedPaths.filter((p) => existing.has(p)) : data.suggested));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("readError"));
    } finally {
      setBusy(false);
    }
  }

  async function use() {
    if (!listing) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      const result = await fetchJson<{ document: { id: string; sizeBytes: number }; skipped: Array<{ path: string; reason: string }> }>(
        `/api/projects/${projectId}/repository/context`,
        { method: "POST", body: JSON.stringify({ commitSha: listing.commitSha, paths: [...chosen] }) },
      );
      const skipped = new Set(result.skipped.map((s) => s.path));
      setSaved({
        id: result.document.id,
        sizeBytes: result.document.sizeBytes,
        repository: listing.repository,
        branch: listing.branch,
        commitSha: listing.commitSha,
        paths: [...chosen].filter((p) => !skipped.has(p)),
      });
      setNotice(result.skipped.length ? t("savedSkipped", { list: result.skipped.map((s) => `${s.path} (${s.reason})`).join(", ") }) : t("saved"));
      setListing(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!saved) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/projects/${projectId}/documents/${saved.id}`, { method: "DELETE" });
      setSaved(null);
      setListing(null);
      setNotice(t("removed"));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("removeError"));
    } finally {
      setBusy(false);
    }
  }

  const size = useMemo(() => (listing ? listing.files.filter((f) => chosen.has(f.path)).reduce((sum, f) => sum + f.size, 0) : 0), [listing, chosen]);
  const visible = listing ? listing.files.filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 200) : [];
  const tooMuch = listing ? size > listing.limits.maxTotalBytes || chosen.size > listing.limits.maxFiles : false;
  const newerCommit = Boolean(listing && saved && listing.commitSha !== saved.commitSha);
  const messages = (
    <>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
    </>
  );

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{t("intro")}</p>
      {saved ? (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2" data-testid="context-saved">
          {/* Text on its own line, buttons below: in the narrow side column a flex row squeezed the text (#275). */}
          <p className="break-words">
            {t("savedState", {
              repo: saved.repository,
              sha: saved.commitSha.slice(0, 7),
              n: saved.paths.length,
              size: kB(saved.sizeBytes),
              tokens: format.number(tokens(saved.sizeBytes)),
            })}
          </p>
          {canWrite && !listing ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void load()} disabled={busy}>
                {busy ? t("reading") : t("change")}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming("remove")} disabled={busy}>
                {t("remove")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {confirming === "remove" ? (
        <div role="alertdialog" aria-label={t("removeConfirm")} className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <p>{t("removeConfirm")}</p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              {t("removeYes")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      {!listing ? (
        <>
          {!saved ? (
            <Button variant="ghost" onClick={() => void load()} disabled={busy || !canWrite}>
              {busy ? t("reading") : t("choose")}
            </Button>
          ) : null}
          {messages}
        </>
      ) : (
        <>
          <p>
            <span className="font-medium">{listing.repository}</span> · {listing.branch} @ <span className="font-mono">{listing.commitSha.slice(0, 7)}</span> ·{" "}
            {t("readable", { n: listing.files.length })}
          </p>
          {newerCommit ? (
            <Alert tone="warning">{t("newerCommit", { saved: saved!.commitSha.slice(0, 7), current: listing.commitSha.slice(0, 7) })}</Alert>
          ) : null}
          <input
            aria-label={t("filterLabel")}
            placeholder={t("filter")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2"
          />
          <ul className="max-h-72 space-y-1 overflow-auto rounded-lg border border-line p-2" aria-label={t("files")}>
            {visible.map((f) => (
              <li key={f.path}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={chosen.has(f.path)}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setChosen((all) => {
                        const next = new Set(all);
                        if (e.target.checked) next.add(f.path);
                        else next.delete(f.path);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 break-all font-mono text-xs">{f.path}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted">{kB(f.size)}</span>
                  {listing.suggested.includes(f.path) ? <Badge tone="accent">{t("suggested")}</Badge> : null}
                </label>
              </li>
            ))}
          </ul>
          <p className={tooMuch ? "text-danger" : "text-muted"} data-testid="context-size">
            {t("size", { n: chosen.size, size: kB(size), tokens: format.number(tokens(size)) })}
            {tooMuch ? ` – ${t("limit", { files: listing.limits.maxFiles, size: kB(listing.limits.maxTotalBytes) })}` : ""}.
          </p>
          {canWrite ? (
            confirming === "save" ? (
              <div role="alertdialog" aria-label={t("saveConfirm")} className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
                <p>{t("saveConfirm")}</p>
                <div className="flex gap-2">
                  <Button onClick={() => void use()} disabled={busy}>
                    {busy ? t("readingFiles") : t("saveYes")}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
                    {t("cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setConfirming("save")} disabled={busy || chosen.size === 0 || tooMuch}>
                  {t("use")}
                </Button>
                <Button variant="ghost" onClick={() => setListing(null)} disabled={busy}>
                  {t("cancel")}
                </Button>
              </div>
            )
          ) : null}
          {messages}
        </>
      )}
    </div>
  );
}
