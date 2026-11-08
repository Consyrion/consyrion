"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { Alert } from "./ui/surface";

/**
 * #197 (ADR 0197): archive or restore a project from its page. Archiving keeps everything readable and exportable but
 * blocks new councils, approvals and builds; running councils keep running. Two clicks instead of a browser dialog.
 */
export function ProjectArchive({ projectId, archived }: { projectId: string; archived: boolean }) {
  const t = useTranslations("projects.archive");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(archived ? `/api/projects/${projectId}/restore` : `/api/projects/${projectId}`, { method: archived ? "POST" : "DELETE" });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2" data-testid="project-archive">
      <p className="text-sm text-muted">{archived ? t("restoreText") : t("archiveText")}</p>
      {error ? <Alert>{error}</Alert> : null}
      {archived ? (
        <Button disabled={busy} onClick={() => void act()}>
          {busy ? t("working") : t("restore")}
        </Button>
      ) : confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void act()}>
            {busy ? t("working") : t("confirm")}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t("cancel")}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          {t("archive")}
        </Button>
      )}
    </div>
  );
}
