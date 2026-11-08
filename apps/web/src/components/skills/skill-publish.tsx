"use client";

import { SKILL_PUBLICATION_LICENSE, slugFromName, type SkillReviewStatus } from "@consyrion/core/browser";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "../ui/button";
import { TextAreaField, TextField } from "../ui/field";
import { Alert, Badge } from "../ui/surface";

/**
 * SkillHub submission (#368 PR 4): status badge, publish panel (upload gate, handle, address, changelog, CC BY 4.0) and
 * withdrawal. Submitting never publishes – the static scan runs, then an admin reviews (ADR docs/adr/0368-skillhub.md).
 */

export interface SkillHubSummary {
  publicVersion: number | null;
  latestStatus: SkillReviewStatus;
  hidden: boolean;
}

interface PublisherStatus {
  handle: string | null;
  problems: Array<"plan" | "email_unverified" | "account_too_new" | "suspended">;
  eligibleFrom: string | null;
}

interface SubmitResult {
  status: SkillReviewStatus;
  slug: string;
  scan: { light: "green" | "yellow" | "red"; findings: Array<{ kind: string; field: string; severity: string }> };
}

/** Public, in review, blocked … – nothing for a skill that was never submitted. */
export function HubStatusBadge({ hub }: { hub: SkillHubSummary | null | undefined }) {
  const t = useTranslations("skills.hub");
  if (!hub) return null;
  if (hub.hidden) return <Badge tone="warning">{t("status.hidden")}</Badge>;
  if (hub.publicVersion !== null) return <Badge tone="success">{t("status.public", { version: hub.publicVersion })}</Badge>;
  if (hub.latestStatus === "draft") return null;
  const tone = hub.latestStatus === "quarantined" || hub.latestStatus === "rejected" ? "danger" : hub.latestStatus === "pending_review" ? "primary" : "neutral";
  return <Badge tone={tone}>{t(`status.${hub.latestStatus}`)}</Badge>;
}

export function PublishPanel({ skill, onClose, onDone }: { skill: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("skills.hub");
  const [status, setStatus] = useState<PublisherStatus | null>(null);
  const [handle, setHandle] = useState("");
  const [slug, setSlug] = useState(slugFromName(skill.name));
  const [listed, setListed] = useState(true);
  const [changelog, setChangelog] = useState("");
  const [license, setLicense] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    fetchJson<PublisherStatus>("/api/skills/publisher")
      .then(setStatus)
      .catch(() => setError(t("error")));
  }, [t]);

  function message(err: unknown) {
    if (!(err instanceof ApiRequestError)) return t("error");
    const reason = (err.details as { reason?: string } | undefined)?.reason;
    return reason && t.has(`errors.${reason}`) ? t(`errors.${reason}`) : err.message;
  }

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const claim = () =>
    act(async () => setStatus(await fetchJson<PublisherStatus>("/api/skills/publisher", { method: "POST", body: JSON.stringify({ handle }) })));

  const submit = () =>
    act(async () => {
      const res = await fetchJson<SubmitResult>(`/api/skills/${encodeURIComponent(skill.id)}/submit`, {
        method: "POST",
        body: JSON.stringify({ slug, listed, changelog, license: license ? SKILL_PUBLICATION_LICENSE.id : undefined }),
      });
      setResult(res);
      onDone();
    });

  return (
    <div className="mt-3 w-full rounded-lg border border-line bg-surface-2 p-4" role="region" aria-label={t("panelLabel", { name: skill.name })}>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="mt-1 text-sm text-muted">{t("intro")}</p>
      {error ? (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {result ? (
        <div className="mt-3 space-y-2">
          <Alert tone={result.status === "quarantined" ? "danger" : "success"}>
            {result.status === "quarantined" ? t("resultBlocked") : t("resultSubmitted", { address: `@${status?.handle ?? ""}/${result.slug}` })}
          </Alert>
          {result.scan.findings.length ? (
            <ul className="list-disc pl-5 text-sm">
              {result.scan.findings.map((f, i) => (
                <li key={i}>
                  {t(`finding.${f.severity === "red" ? "red" : "yellow"}`)}: {t.has(`kind.${f.kind}`) ? t(`kind.${f.kind}`) : f.kind} ({f.field})
                </li>
              ))}
            </ul>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      ) : !status ? (
        <p className="mt-3 text-sm text-muted">{t("loading")}</p>
      ) : status.problems.length ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">{t("notEligible")}</p>
          <ul className="list-disc pl-5 text-sm">
            {status.problems.map((p) => (
              <li key={p}>
                {p === "account_too_new" && status.eligibleFrom
                  ? t("problem.account_too_new", { date: new Date(status.eligibleFrom).toLocaleDateString() })
                  : t(`problem.${p}`)}
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      ) : !status.handle ? (
        <div className="mt-3 space-y-2">
          <TextField label={t("handle")} hint={t("handleHint")} value={handle} maxLength={32} onChange={(e) => setHandle(e.target.value.toLowerCase())} />
          <span className="flex gap-2">
            <Button disabled={busy || handle.length < 3} onClick={() => void claim()}>
              {t("claim")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
          </span>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <TextField
            label={t("address")}
            hint={t("addressHint", { address: `@${status.handle}/${slug || "…"}` })}
            value={slug}
            maxLength={60}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
            {t("listed")}
          </label>
          <p className="text-xs text-muted">{t("listedHint")}</p>
          <TextAreaField
            label={t("changelog")}
            hint={t("changelogHint")}
            value={changelog}
            maxLength={500}
            rows={2}
            onChange={(e) => setChangelog(e.target.value)}
          />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={license} onChange={(e) => setLicense(e.target.checked)} />
            <span>
              {t("license", { license: SKILL_PUBLICATION_LICENSE.name })}{" "}
              <a className="underline" href={SKILL_PUBLICATION_LICENSE.url} target="_blank" rel="noreferrer noopener">
                {SKILL_PUBLICATION_LICENSE.id}
              </a>
            </span>
          </label>
          <p className="text-xs text-muted">{t("reviewNote")}</p>
          <span className="flex gap-2">
            <Button disabled={busy || !license || !changelog.trim() || !slug} onClick={() => void submit()}>
              {t("submit")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
