"use client";

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
}: {
  projectId: string;
  linked: string | null;
  integrations: Integration[];
  canWrite: boolean;
  githubConfigured: boolean;
  /** False when the workspace plan does not include GitHub; shown before anything is loaded. */
  githubAllowed?: boolean;
}) {
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
      setError(err instanceof ApiRequestError ? err.message : "Could not load repositories");
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
      setError(err instanceof ApiRequestError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {linked ? (
        <p>
          Linked: <strong>{linked}</strong>
        </p>
      ) : (
        <p className="text-muted">No repository linked. The Execution Council will start from an empty workspace.</p>
      )}
      {!githubConfigured ? <p className="text-muted">GitHub is not configured on this server.</p> : null}
      {githubConfigured && !githubAllowed ? (
        <p className="text-muted">
          GitHub is not included in your plan.{" "}
          <a className="text-primary underline" href="/settings/billing">
            See Billing &amp; usage
          </a>
          .
        </p>
      ) : null}
      {githubConfigured && githubAllowed && integrations.length === 0 ? (
        <p className="text-muted">
          Connect GitHub under <a className="text-primary underline" href="/settings/integrations">Integrations</a> first.
        </p>
      ) : null}
      {canWrite && githubConfigured && githubAllowed && integrations.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <SelectField label="GitHub account" value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
              {integrations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.accountLogin}
                </option>
              ))}
            </SelectField>
            <Button variant="secondary" onClick={() => void load()}>
              Load repositories
            </Button>
          </div>
          {repos ? (
            <div className="flex flex-wrap items-end gap-2">
              <SelectField label="Repository" value={repo} onChange={(e) => setRepo(e.target.value)}>
                {repos.map((r) => (
                  <option key={r.fullName} value={r.fullName}>
                    {r.fullName} ({r.defaultBranch})
                  </option>
                ))}
              </SelectField>
              <Button onClick={() => void save()} disabled={busy || !repo}>
                Link
              </Button>
            </div>
          ) : null}
          {linked ? (
            <Button variant="ghost" onClick={() => void save(true)} disabled={busy}>
              Unlink repository
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
