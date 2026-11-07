"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField, TextAreaField, TextField } from "./ui/field";
import { Select } from "./ui/select";
import { Alert } from "./ui/surface";

/** Kinds, states and limits of the feedback inbox (#295) – same values as the repository in @consyrion/db. */
export const FEEDBACK_KIND_KEYS = ["bug", "feature", "contact"] as const;
export const FEEDBACK_STATE_KEYS = ["new", "in_progress", "done"] as const;
const SUBJECT_MAX = 120;
const TEXT_MAX = 4000;

type Kind = (typeof FEEDBACK_KIND_KEYS)[number];
type State = (typeof FEEDBACK_STATE_KEYS)[number];

/** A path of this app to attach as "page" – only same-origin paths, never a full URL from the query string. */
function safePath(from: string | null | undefined, fallback: string) {
  return from && from.startsWith("/") && !from.startsWith("//") ? from.split(/[?#]/)[0]!.slice(0, 200) : fallback;
}

/**
 * Feedback form: signed-in users report with their account; visitors (`visitor`) leave an e-mail address. A hidden
 * honeypot field catches simple bots. Page, language, browser and app version are attached by the server.
 */
export function FeedbackForm({ visitor = false, from }: { visitor?: boolean; from?: string | null }) {
  const t = useTranslations("feedback");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const page = safePath(from, pathname);
  const [kind, setKind] = useState<Kind>("bug");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await fetchJson("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ kind, subject, text, email: visitor ? email : undefined, website, page, locale }),
      });
      setSent(true);
      setSubject("");
      setText("");
      if (!visitor) router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const fields = Object.keys(err.fieldErrors ?? {});
        setFieldErrors(
          Object.fromEntries(fields.filter((f) => ["subject", "text", "email"].includes(f)).map((f) => [f, t(`errors.${f as "subject" | "text" | "email"}`)])),
        );
        setError(err.status === 429 ? t("rateLimited") : fields.length ? t("errors.fields") : t("error"));
      } else setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="space-y-4">
        <Alert tone="success">{visitor ? t("sentVisitor") : t("sentUser")}</Alert>
        <Button variant="secondary" onClick={() => setSent(false)}>
          {t("another")}
        </Button>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-4">
      <SelectField label={t("kind")} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
        {FEEDBACK_KIND_KEYS.map((k) => (
          <option key={k} value={k}>
            {t(`kinds.${k}`)}
          </option>
        ))}
      </SelectField>
      {visitor ? (
        <TextField
          label={t("email")}
          hint={t("emailHint")}
          type="email"
          autoComplete="email"
          required
          maxLength={200}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
      ) : null}
      <TextField
        label={t("subject")}
        hint={t("subjectHint", { max: SUBJECT_MAX })}
        required
        maxLength={SUBJECT_MAX}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        error={fieldErrors.subject}
      />
      <TextAreaField
        label={t("text")}
        hint={t("textHint", { max: TEXT_MAX, count: text.length })}
        required
        maxLength={TEXT_MAX}
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        error={fieldErrors.text}
      />
      {/* Honeypot: invisible for people and assistive technology; bots that fill every field are dropped silently. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          {t("honeypot")}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-muted">{t("attached", { page })}</p>
      <p className="text-xs text-muted">
        {t("privacy")}{" "}
        <Link href="/datenschutz" className="underline hover:text-text">
          {t("privacyLink")}
        </Link>
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" disabled={busy || !subject.trim() || !text.trim() || (visitor && !email.trim())}>
        {busy ? t("sending") : t("send")}
      </Button>
    </form>
  );
}

/** Filters of the admin inbox: kind and state are kept in the URL so the list is rendered on the server. */
export function FeedbackFilters({ kind, state }: { kind: string; state: string }) {
  const t = useTranslations("feedback");
  const router = useRouter();
  function set(key: "kind" | "state", value: string) {
    const next = new URLSearchParams();
    const values = { kind, state, [key]: value };
    for (const [k, v] of Object.entries(values)) if (v) next.set(k, v);
    router.push(`/admin/feedback${next.size ? `?${next}` : ""}`);
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select aria-label={t("admin.filterKind")} value={kind} onChange={(e) => set("kind", e.target.value)}>
        <option value="">{t("admin.allKinds")}</option>
        {FEEDBACK_KIND_KEYS.map((k) => (
          <option key={k} value={k}>
            {t(`kinds.${k}`)}
          </option>
        ))}
      </Select>
      <Select aria-label={t("admin.filterState")} value={state} onChange={(e) => set("state", e.target.value)}>
        <option value="">{t("admin.allStates")}</option>
        {FEEDBACK_STATE_KEYS.map((s) => (
          <option key={s} value={s}>
            {t(`states.${s}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Actions on one report in the admin inbox: status, reply, delete (with an in-page confirmation). */
export function AdminFeedbackActions({ id, state, listHref }: { id: string; state: State; listHref: string }) {
  const t = useTranslations("feedback.admin");
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }
  const setState = (next: State) => run(() => fetchJson(`/api/admin/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ state: next }) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {state !== "in_progress" ? (
          <Button variant="secondary" disabled={busy} onClick={() => void setState("in_progress")}>
            {t("markInProgress")}
          </Button>
        ) : null}
        {state !== "done" ? (
          <Button variant="secondary" disabled={busy} onClick={() => void setState("done")}>
            {t("markDone")}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => void setState("new")}>
            {t("reopen")}
          </Button>
        )}
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => fetchJson(`/api/admin/feedback/${id}/reply`, { method: "POST", body: JSON.stringify({ text: reply }) }),
            () => setReply(""),
          );
        }}
      >
        <TextAreaField label={t("reply")} hint={t("replyHint")} maxLength={TEXT_MAX} rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
        <Button type="submit" disabled={busy || !reply.trim()}>
          {t("sendReply")}
        </Button>
      </form>
      {confirming ? (
        <div role="alertdialog" aria-label={t("deleteConfirm")} className="space-y-3 rounded-xl border border-danger/50 bg-danger/5 p-4">
          <p className="text-sm">{t("deleteConfirm")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(
                  () => fetchJson(`/api/admin/feedback/${id}`, { method: "DELETE" }),
                  () => router.push(listHref),
                )
              }
            >
              {t("deleteYes")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
          {t("delete")}
        </Button>
      )}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
