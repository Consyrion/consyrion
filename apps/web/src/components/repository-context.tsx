"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { Alert, Badge } from "./ui/surface";

interface Listing {
  repository: string;
  branch: string;
  commitSha: string;
  files: Array<{ path: string; size: number }>;
  suggested: string[];
  limits: { maxTotalBytes: number; maxFiles: number };
  current: { name: string; sizeBytes: number; origin: { commitSha: string; paths: string[] } | null } | null;
}

const kB = (bytes: number) => `${Math.max(1, Math.round(bytes / 1000))} kB`;
/** About four characters per token – the same rough rate as the cost preview. */
const tokens = (bytes: number) => Math.round(bytes / 4);

/**
 * Repository context for Decision councils (docs/documents.md): the user chooses which files of the linked repository
 * the models read. A suggestion is preselected; nothing is read before "Use as context".
 */
export function RepositoryContext({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const t = useTranslations("repoContext");
  const format = useFormatter();
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await fetchJson<Listing>(`/api/projects/${projectId}/repository/context`);
      setListing(data);
      setChosen(new Set(data.current?.origin && data.current.origin.commitSha === data.commitSha ? data.current.origin.paths : data.suggested));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("readError"));
    } finally {
      setBusy(false);
    }
  }

  async function use() {
    if (!listing) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchJson<{ skipped: Array<{ path: string; reason: string }> }>(`/api/projects/${projectId}/repository/context`, {
        method: "POST",
        body: JSON.stringify({ commitSha: listing.commitSha, paths: [...chosen] }),
      });
      setNotice(
        result.skipped.length
          ? t("savedSkipped", { list: result.skipped.map((s) => `${s.path} (${s.reason})`).join(", ") })
          : t("saved"),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("saveError"));
    } finally {
      setBusy(false);
    }
  }

  const size = useMemo(() => (listing ? listing.files.filter((f) => chosen.has(f.path)).reduce((sum, f) => sum + f.size, 0) : 0), [listing, chosen]);
  const visible = listing ? listing.files.filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 200) : [];
  const tooMuch = listing ? size > listing.limits.maxTotalBytes || chosen.size > listing.limits.maxFiles : false;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{t("intro")}</p>
      {!listing ? (
        <Button variant="ghost" onClick={() => void load()} disabled={busy || !canWrite}>
          {busy ? t("reading") : t("choose")}
        </Button>
      ) : (
        <>
          <p>
            <span className="font-medium">{listing.repository}</span> · {listing.branch} @ <span className="font-mono">{listing.commitSha.slice(0, 7)}</span> ·{" "}
            {t("readable", { n: listing.files.length })}
          </p>
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
            <Button onClick={() => void use()} disabled={busy || chosen.size === 0 || tooMuch}>
              {busy ? t("readingFiles") : t("use")}
            </Button>
          ) : null}
        </>
      )}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
