"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "../ui/button";
import { SelectField, TextAreaField, TextField } from "../ui/field";
import { Alert, Badge } from "../ui/surface";

/**
 * SkillHub admin (#368 PR 5): the review queue and the model reviewer settings. Skill text is shown as plain text only.
 * Red is never publishable; yellow and green are approved here; auto-approval is an opt-in switch (green in both checks).
 */

type Light = "green" | "yellow" | "red";
type Status = "pending_review" | "quarantined" | "published";

interface QueueItem {
  skillId: string;
  kind: "skill" | "role_profile";
  name: string;
  version: number;
  status: string;
  contentHash: string;
  handle: string | null;
  slug: string | null;
  hidden: boolean;
  scanLight: Light | null;
  aiLight: Light | null;
  aiSkipped: string | null;
  publisherSuspended: boolean;
  ownerUserId: string;
}

interface Detail extends QueueItem {
  content: {
    name: string;
    summary?: string;
    category?: string;
    roles?: string[];
    requirementBlocks?: string[];
    weights?: Record<string, number>;
    sessionRules?: string;
    knowledge?: string;
    // expert profile fields (kind "role_profile")
    coreQuestion?: string;
    lenses?: string[];
    notSuitableFor?: string;
    sources?: Array<{ title: string; url: string | null; note: string | null }>;
  };
  changelog: string | null;
  scan: { findings: Array<{ kind: string; field: string; severity: string; message: string; excerpt?: string }> } | null;
  aiReview: { summary?: string; findings?: Array<{ field: string; light: string; category: string; reason: string }> } | null;
  reviewNote: string | null;
  ownerEmail: string | null;
}

interface ReviewerConfig {
  settings: { enabled: boolean; provider: string; model: string; maxTokensPerReview: number; monthlyTokenBudget: number; autoApproveGreen: boolean };
  hasKey: boolean;
  usedThisMonth: number;
}

const TONE: Record<Light, "success" | "warning" | "danger"> = { green: "success", yellow: "warning", red: "danger" };

export function SkillHubAdmin({ providers }: { providers: ReadonlyArray<{ id: string; label: string }> }) {
  const t = useTranslations("settings.admin.skillHub");
  const [status, setStatus] = useState<Status>("pending_review");
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const message = useCallback(
    (err: unknown) => {
      if (!(err instanceof ApiRequestError)) return t("error");
      const reason = (err.details as { reason?: string } | undefined)?.reason;
      return reason && t.has(`errors.${reason}`) ? t(`errors.${reason}`) : err.message;
    },
    [t],
  );

  const load = useCallback(async () => {
    try {
      setItems((await fetchJson<{ items: QueueItem[] }>(`/api/admin/skills?status=${status}`)).items);
    } catch (err) {
      setError(message(err));
    }
  }, [status, message]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      setOpen(null);
      setNote("");
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function show(item: QueueItem) {
    if (open?.skillId === item.skillId && open.version === item.version) return setOpen(null);
    try {
      setOpen(await fetchJson<Detail>(`/api/admin/skills/${encodeURIComponent(item.skillId)}/versions/${item.version}`));
      setNote("");
    } catch (err) {
      setError(message(err));
    }
  }

  const decide = (d: Detail, decision: "approve" | "reject" | "quarantine" | "restore") =>
    act(
      () =>
        fetchJson(`/api/admin/skills/${encodeURIComponent(d.skillId)}/versions/${d.version}`, {
          method: "POST",
          body: JSON.stringify({ decision, contentHash: d.contentHash, note }),
        }),
      t(`done.${decision}`),
    );

  const light = (l: Light | null, label: string) => (l ? <Badge tone={TONE[l]}>{`${label}: ${t(`light.${l}`)}`}</Badge> : null);

  return (
    <div className="space-y-6">
      <ReviewerSettings providers={providers} />
      <OpenReports />
      <OfficialSkills />
      <div>
        <h3 className="font-semibold">{t("queueTitle")}</h3>
        <p className="mt-1 text-sm text-muted">{t("queueText")}</p>
        <Button
          variant="ghost"
          className="mt-2"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const r = await fetchJson<{ rescanned: number; quarantined: unknown[] }>("/api/admin/skills/rescan", { method: "POST" });
              setNotice(t("done.rescan", { rescanned: r.rescanned, quarantined: r.quarantined.length }));
            }, "")
          }
        >
          {t("rescan")}
        </Button>
        <div className="mt-3 flex flex-wrap gap-2" role="tablist">
          {(["pending_review", "quarantined", "published"] as const).map((s) => (
            <Button key={s} variant={status === s ? "primary" : "secondary"} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
              {t(`tab.${s}`)}
            </Button>
          ))}
        </div>
        {error ? (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        ) : null}
        {notice ? (
          <div className="mt-3">
            <Alert tone="success">{notice}</Alert>
          </div>
        ) : null}
        {items === null ? (
          <p className="mt-3 text-sm text-muted">{t("loading")}</p>
        ) : items.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {items.map((item) => (
              <li key={`${item.skillId}:${item.version}`} className="py-3">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong>{item.name}</strong>
                    <Badge tone="neutral">{t(`kind.${item.kind}`)}</Badge>
                    <span className="text-xs text-muted">
                      @{item.handle ?? "?"}/{item.slug ?? "?"} · v{item.version}
                    </span>
                    {light(item.scanLight, t("scan"))}
                    {light(item.aiLight, t("ai"))}
                    {item.aiSkipped ? <Badge tone="neutral">{t("aiSkipped", { reason: item.aiSkipped })}</Badge> : null}
                    {item.hidden ? <Badge tone="warning">{t("hidden")}</Badge> : null}
                    {item.publisherSuspended ? <Badge tone="danger">{t("suspended")}</Badge> : null}
                  </span>
                  <Button variant="ghost" aria-expanded={open?.skillId === item.skillId && open.version === item.version} onClick={() => void show(item)}>
                    {open?.skillId === item.skillId && open.version === item.version ? t("close") : t("open")}
                  </Button>
                </span>
                {open && open.skillId === item.skillId && open.version === item.version ? (
                  <div className="mt-3 space-y-3 rounded-lg border border-line bg-surface-2 p-3 text-sm">
                    <dl className="grid gap-2">
                      <Field label={t("field.summary")} text={open.content.summary ?? ""} />
                      <Field label={t("field.changelog")} text={open.changelog ?? ""} />
                      <Field label={t("field.blocks")} text={(open.content.requirementBlocks ?? []).join("\n")} />
                      <Field
                        label={t("field.weights")}
                        text={Object.entries(open.content.weights ?? {})
                          .map(([k, v]) => `${k} ${v} %`)
                          .join(", ")}
                      />
                      <Field label={t("field.rules")} text={open.content.sessionRules ?? ""} />
                      <Field label={t("field.knowledge")} text={open.content.knowledge ?? ""} />
                      <Field label={t("field.coreQuestion")} text={open.content.coreQuestion ?? ""} />
                      <Field label={t("field.lenses")} text={(open.content.lenses ?? []).join("\n")} />
                      <Field label={t("field.notSuitableFor")} text={open.content.notSuitableFor ?? ""} />
                      <Field
                        label={t("field.sources")}
                        text={(open.content.sources ?? []).map((src) => [src.title, src.url, src.note].filter(Boolean).join(" – ")).join("\n")}
                      />
                      <Field label={t("field.owner")} text={open.ownerEmail ?? ""} />
                    </dl>
                    {open.scan?.findings.length ? (
                      <div>
                        <p className="font-medium">{t("scanFindings")}</p>
                        <ul className="list-disc pl-5">
                          {open.scan.findings.map((f, i) => (
                            <li key={i}>
                              {t(`light.${f.severity === "red" ? "red" : "yellow"}`)} · {f.field}: {f.message}
                              {f.excerpt ? <span className="block text-xs text-muted">{f.excerpt}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {open.aiReview?.findings?.length || open.aiReview?.summary ? (
                      <div>
                        <p className="font-medium">{t("aiFindings")}</p>
                        {open.aiReview.summary ? <p>{open.aiReview.summary}</p> : null}
                        <ul className="list-disc pl-5">
                          {(open.aiReview.findings ?? []).map((f, i) => (
                            <li key={i}>
                              {f.light} · {f.field} · {f.category}: {f.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <TextAreaField label={t("note")} hint={t("noteHint")} value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
                    <span className="flex flex-wrap gap-2">
                      {open.status === "pending_review" ? (
                        <>
                          <Button disabled={busy || open.scanLight === "red" || open.aiLight === "red"} onClick={() => void decide(open, "approve")}>
                            {t("approve")}
                          </Button>
                          <Button variant="secondary" disabled={busy} onClick={() => void decide(open, "reject")}>
                            {t("reject")}
                          </Button>
                          <Button variant="secondary" disabled={busy} onClick={() => void decide(open, "quarantine")}>
                            {t("quarantine")}
                          </Button>
                        </>
                      ) : null}
                      {open.status === "quarantined" ? (
                        <>
                          <Button variant="secondary" disabled={busy || open.scanLight === "red"} onClick={() => void decide(open, "restore")}>
                            {t("restore")}
                          </Button>
                          <Button variant="secondary" disabled={busy} onClick={() => void decide(open, "reject")}>
                            {t("reject")}
                          </Button>
                        </>
                      ) : null}
                      {open.status === "published" ? (
                        <>
                          <Button variant="secondary" disabled={busy} onClick={() => void decide(open, "quarantine")}>
                            {t("quarantine")}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                () =>
                                  fetchJson(`/api/admin/skills/${encodeURIComponent(open.skillId)}/hidden`, {
                                    method: "POST",
                                    body: JSON.stringify({ hidden: !open.hidden, reason: note }),
                                  }),
                                open.hidden ? t("done.unhide") : t("done.hide"),
                              )
                            }
                          >
                            {open.hidden ? t("unhide") : t("hide")}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              fetchJson(`/api/admin/skill-publishers/${encodeURIComponent(open.ownerUserId)}`, {
                                method: "POST",
                                body: JSON.stringify({ suspended: !open.publisherSuspended, reason: note }),
                              }),
                            open.publisherSuspended ? t("done.unsuspend") : t("done.suspend"),
                          )
                        }
                      >
                        {open.publisherSuspended ? t("unsuspend") : t("suspend")}
                      </Button>
                    </span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{text}</dd>
    </div>
  );
}

function ReviewerSettings({ providers }: { providers: ReadonlyArray<{ id: string; label: string }> }) {
  const t = useTranslations("settings.admin.skillHub.reviewer");
  const [config, setConfig] = useState<ReviewerConfig | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    fetchJson<ReviewerConfig>("/api/admin/skill-reviewer")
      .then(setConfig)
      .catch(() => setMessage({ tone: "danger", text: t("error") }));
  }, [t]);

  if (!config) return <p className="text-sm text-muted">{t("loading")}</p>;
  const s = config.settings;
  const set = (patch: Partial<ReviewerConfig["settings"]>) => setConfig({ ...config, settings: { ...s, ...patch } });

  async function save(extra: { apiKey?: string; removeKey?: boolean } = {}) {
    setBusy(true);
    setMessage(null);
    try {
      setConfig(await fetchJson<ReviewerConfig>("/api/admin/skill-reviewer", { method: "PUT", body: JSON.stringify({ ...s, ...extra }) }));
      setKey("");
      setMessage({ tone: "success", text: t("saved") });
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiRequestError ? err.message : t("error") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line p-4">
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="mt-1 text-sm text-muted">{t("text")}</p>
      {message ? (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {t("enabled")}
        </label>
        <SelectField label={t("provider")} value={s.provider} onChange={(e) => set({ provider: e.target.value })}>
          <option value="">{t("chooseProvider")}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </SelectField>
        <TextField label={t("model")} hint={t("modelHint")} value={s.model} onChange={(e) => set({ model: e.target.value })} />
        <TextField
          label={t("perReview")}
          type="number"
          min={1000}
          value={String(s.maxTokensPerReview)}
          onChange={(e) => set({ maxTokensPerReview: Number(e.target.value) || 0 })}
        />
        <TextField
          label={t("perMonth")}
          hint={t("used", { used: config.usedThisMonth })}
          type="number"
          min={1000}
          value={String(s.monthlyTokenBudget)}
          onChange={(e) => set({ monthlyTokenBudget: Number(e.target.value) || 0 })}
        />
        <TextField
          label={t("key")}
          hint={config.hasKey ? t("keySet") : t("keyMissing")}
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input type="checkbox" className="mt-1" checked={s.autoApproveGreen} onChange={(e) => set({ autoApproveGreen: e.target.checked })} />
          <span>
            {t("autoApprove")}
            <span className="block text-xs text-muted">{t("autoApproveHint")}</span>
          </span>
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">{t("exception")}</p>
      <span className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void save(key.trim() ? { apiKey: key } : {})}>
          {t("save")}
        </Button>
        {config.hasKey ? (
          <Button variant="secondary" disabled={busy} onClick={() => void save({ removeKey: true })}>
            {t("removeKey")}
          </Button>
        ) : null}
      </span>
    </div>
  );
}

interface OpenReport {
  id: string;
  name: string;
  handle: string | null;
  slug: string | null;
  version: number;
  reason: string;
  note: string | null;
  createdAt: string;
  openOnSkill: number;
}

/** Open reports (#368 PR 6). Closing a report never hides anything – hiding is the explicit action in the queue. */
function OpenReports() {
  const t = useTranslations("settings.admin.skillHub.reports");
  const tReason = useTranslations("skillHub.actions.reasons");
  const [reports, setReports] = useState<OpenReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReports((await fetchJson<{ reports: OpenReport[] }>("/api/admin/skill-reports")).reports);
    } catch {
      setError(t("error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function close(id: string, status: "resolved" | "dismissed") {
    try {
      await fetchJson(`/api/admin/skill-reports/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ status }) });
      await load();
    } catch {
      setError(t("error"));
    }
  }

  return (
    <div className="rounded-lg border border-line p-4">
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="mt-1 text-sm text-muted">{t("text")}</p>
      {error ? (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {reports === null ? (
        <p className="mt-3 text-sm text-muted">{t("loading")}</p>
      ) : reports.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
              <span className="min-w-0">
                <strong>{r.name}</strong>{" "}
                <span className="text-xs text-muted">
                  @{r.handle ?? "?"}/{r.slug ?? "?"} · v{r.version} · {new Date(r.createdAt).toLocaleDateString()}
                </span>
                <span className="mt-1 flex flex-wrap gap-2">
                  <Badge tone="warning">{tReason.has(r.reason) ? tReason(r.reason) : r.reason}</Badge>
                  {r.openOnSkill > 1 ? <Badge tone="danger">{t("openOnSkill", { n: r.openOnSkill })}</Badge> : null}
                </span>
                {r.note ? <span className="mt-1 block whitespace-pre-wrap break-words">{r.note}</span> : null}
              </span>
              <span className="flex gap-2">
                <Button variant="secondary" onClick={() => void close(r.id, "resolved")}>
                  {t("resolve")}
                </Button>
                <Button variant="ghost" onClick={() => void close(r.id, "dismissed")}>
                  {t("dismiss")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface OfficialRow {
  slug: string;
  name: string;
  version: number;
  contentHash: string;
  scanLight: Light;
  hidden: boolean;
}

/** Official skills (@consyrium) in the public catalog: hide or show without a deploy (#368 PR 7). */
function OfficialSkills() {
  const t = useTranslations("settings.admin.skillHub.official");
  const [rows, setRows] = useState<OfficialRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await fetchJson<{ skills: OfficialRow[] }>("/api/admin/skills/official")).skills);
    } catch {
      setError(t("error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(row: OfficialRow) {
    try {
      await fetchJson(`/api/admin/skills/official/${encodeURIComponent(row.slug)}`, { method: "POST", body: JSON.stringify({ hidden: !row.hidden }) });
      await load();
    } catch {
      setError(t("error"));
    }
  }

  return (
    <div className="rounded-lg border border-line p-4">
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="mt-1 text-sm text-muted">{t("text")}</p>
      {error ? (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {rows === null ? (
        <p className="mt-3 text-sm text-muted">{t("loading")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.slug} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <strong>{r.name}</strong>{" "}
                <span className="text-xs text-muted">
                  @consyrium/{r.slug} · v{r.version} · {r.contentHash.slice(0, 12)}
                </span>{" "}
                <Badge tone={TONE[r.scanLight]}>{r.scanLight}</Badge> {r.hidden ? <Badge tone="warning">{t("hidden")}</Badge> : null}
              </span>
              <Button variant="secondary" onClick={() => void toggle(r)}>
                {r.hidden ? t("show") : t("hide")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
