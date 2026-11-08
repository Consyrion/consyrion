"use client";

import { SKILL_REPORT_REASONS } from "@consyrion/core/browser";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "../ui/button";
import { SelectField, TextAreaField } from "../ui/field";
import { Alert } from "../ui/surface";

/**
 * Actions on a public skill page (#368 PR 6): adopt it as an own private copy, or report it to the admins. The page is
 * cached without login, so the session is checked by the API: a 401 shows the sign-in link instead.
 */
export function PublicSkillActions({ handle, slug }: { handle: string; slug: string }) {
  const t = useTranslations("skillHub.actions");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ tone: "success" | "danger"; text: string; signIn?: boolean; mySkills?: boolean } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  async function call(path: string, body: Record<string, unknown>, done: string, mySkills = false) {
    setBusy(true);
    setState(null);
    try {
      await fetchJson(path, { method: "POST", body: JSON.stringify({ handle, slug, ...body }) });
      setState({ tone: "success", text: done, mySkills });
      setReporting(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setState({ tone: "danger", text: t("signInNeeded"), signIn: true });
      else {
        const reasonCode = err instanceof ApiRequestError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
        setState({
          tone: "danger",
          text: reasonCode && t.has(`errors.${reasonCode}`) ? t(`errors.${reasonCode}`) : err instanceof ApiRequestError ? err.message : t("error"),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      <span className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void call("/api/skills/hub/adopt", {}, t("adopted"), true)}>
          {t("adopt")}
        </Button>
        <Button variant="ghost" disabled={busy} aria-expanded={reporting} onClick={() => setReporting(!reporting)}>
          {t("report")}
        </Button>
      </span>
      <p className="text-xs text-muted">{t("adoptHint")}</p>
      {state ? (
        <Alert tone={state.tone}>
          {state.text}{" "}
          {state.signIn ? (
            <Link className="underline" href="/sign-in">
              {t("signIn")}
            </Link>
          ) : null}
          {state.mySkills ? (
            <Link className="underline" href="/settings/skills">
              {t("mySkills")}
            </Link>
          ) : null}
        </Alert>
      ) : null}
      {reporting ? (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <SelectField label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t("chooseReason")}</option>
            {SKILL_REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reasons.${r}`)}
              </option>
            ))}
          </SelectField>
          <TextAreaField label={t("note")} value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} />
          <p className="text-xs text-muted">{t("reportHint")}</p>
          <Button variant="secondary" disabled={busy || !reason} onClick={() => void call("/api/skills/hub/report", { reason, note }, t("reported"))}>
            {t("sendReport")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
