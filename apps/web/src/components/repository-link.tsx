"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField } from "./ui/field";
import { Alert } from "./ui/surface";

interface Integration {
  id: string;
  accountLogin: string;
}

/** Links a GitHub repository to the project; the Execution Council then starts from its default branch. */
export function RepositoryLink({
  projectId,
  linked,
  integrations,
  canWrite,
  githubConfigured,
  githubAllowed = true,
  requestedUrl = null,
}: {
  projectId: string;
  linked: string | null;
  integrations: Integration[];
  canWrite: boolean;
  githubConfigured: boolean;
  /** False when the workspace plan does not include GitHub; shown before anything is loaded. */
  githubAllowed?: boolean;
  /** Repository URL from the brief; when it is set but not linked, the GitHub App usually cannot see it. */
  requestedUrl?: string | null;
}) {
  const t = useTranslations("repoLink");
  const router = useRouter();
  const [integrationId, setIntegrationId] = useState(integrations[0]?.id ?? "");
  const [repos, setRepos] = useState<Array<{ fullName: string; defaultBranch: string; private: boolean }> | null>(null);
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const result = await fetchJson<{ repositories: Array<{ fullName: string; defaultBranch: string; private: boolean }> }>(`/api/github/repositories?integrationId=${integrationId}`);
      setRepos(result.repositories);
      setRepo(result.repositories[0]?.fullName ?? "");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("loadError"));
    }
  }

  async function save(remove = false) {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/projects/${projectId}/repository`, remove ? { method: "DELETE" } : { method: "POST", body: JSON.stringify({ integrationId, fullName: repo }) });
      router.refresh();
      setRepos(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {linked ? (
        <p>{t.rich("linked", { repo: linked, strong: (chunks) => <strong>{chunks}</strong> })}</p>
      ) : (
        <p className="text-muted">{t("none")}</p>
      )}
      {!linked && requestedUrl && githubConfigured && githubAllowed ? (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-warning">
          {t("notLinked", { url: requestedUrl })}
        </p>
      ) : null}
      {!githubConfigured ? <p className="text-muted">{t("notConfigured")}</p> : null}
      {githubConfigured && !githubAllowed ? (
        <p className="text-muted">
          {t.rich("notInPlan", {
            link: (chunks) => (
              <a className="text-primary underline" href="/settings/billing">
                {chunks}
              </a>
            ),
          })}
        </p>
      ) : null}
      {githubConfigured && githubAllowed && integrations.length === 0 ? (
        <p className="text-muted">
          {t.rich("connectFirst", {
            link: (chunks) => (
              <a className="text-primary underline" href="/settings/integrations">
                {chunks}
              </a>
            ),
          })}
        </p>
      ) : null}
      {canWrite && githubConfigured && githubAllowed && integrations.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <SelectField label={t("account")} value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
              {integrations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.accountLogin}
                </option>
              ))}
            </SelectField>
            <Button variant="secondary" onClick={() => void load()}>
              {t("load")}
            </Button>
          </div>
          {repos ? (
            <div className="flex flex-wrap items-end gap-2">
              <SelectField label={t("repository")} value={repo} onChange={(e) => setRepo(e.target.value)}>
                {repos.map((r) => (
                  <option key={r.fullName} value={r.fullName}>
                    {r.fullName} ({r.defaultBranch})
                  </option>
                ))}
              </SelectField>
              <Button onClick={() => void save()} disabled={busy || !repo}>
                {t("link")}
              </Button>
            </div>
          ) : null}
          {linked ? (
            <Button variant="ghost" onClick={() => void save(true)} disabled={busy}>
              {t("unlink")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
