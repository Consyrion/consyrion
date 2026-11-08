"use client";

import { COUNCIL_ROLES, CRITERIA, DECISION_MODE_LABELS, MAX_PARTICIPANTS, MIN_PARTICIPANTS, type CouncilRole } from "@consyrion/core/browser";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "../ui/button";
import { SelectField, TextAreaField, TextField } from "../ui/field";
import { Alert, Badge, Card } from "../ui/surface";
import { HubStatusBadge, PublishPanel, type SkillHubSummary } from "./skill-publish";

/** Settings → Skills (#363). The server validates and scans every save; this form only collects and previews. */

const CATEGORIES = ["architecture", "data_protection", "vendor", "security", "cost", "other"] as const;
const MODES = ["independent_expert", "adversarial_review", "consensus"] as const;

export interface SkillRow {
  id: string;
  name: string;
  summary: string;
  category: string;
  visibility: "private" | "team" | "official";
  version: number;
  contentHash: string;
  editable: boolean;
  updatedAt: string | null;
  /** Source of a duplicated skill (#422). */
  forkedFrom?: { skillId: string; name: string; version: number; contentHash: string } | null;
  /** SkillHub state (#368); null for official skills. */
  hub?: SkillHubSummary | null;
}

interface VersionRow {
  version: number;
  contentHash: string;
  changelog: string | null;
  createdAt: string | null;
}

interface Draft {
  name: string;
  summary: string;
  category: string;
  mode: string;
  models: string;
  roles: CouncilRole[];
  blocks: string;
  useWeights: boolean;
  weights: Record<(typeof CRITERIA)[number], string>;
  sessionRules: string;
  knowledge: string;
  /** What changed in this version (#422) – optional, not part of the content. */
  changelog: string;
}

const EMPTY: Draft = {
  name: "",
  summary: "",
  category: "other",
  mode: "",
  models: "",
  roles: [],
  blocks: "",
  useWeights: false,
  weights: { technicalQuality: "30", security: "25", maintainability: "20", operatingCost: "15", implementationSpeed: "10" },
  sessionRules: "",
  knowledge: "",
  changelog: "",
};

type Content = {
  name: string;
  summary: string;
  category: string;
  council?: { mode?: string; models?: number };
  roles?: string[];
  requirementBlocks?: string[];
  weights?: Record<string, number>;
  sessionRules?: string;
  knowledge?: string;
};

function toContent(d: Draft): Content {
  const council: { mode?: string; models?: number } = {};
  if (d.mode) council.mode = d.mode;
  if (d.models) council.models = Number(d.models);
  return {
    name: d.name,
    summary: d.summary,
    category: d.category,
    ...(Object.keys(council).length ? { council } : {}),
    ...(d.roles.length ? { roles: d.roles } : {}),
    ...(d.blocks.trim()
      ? {
          requirementBlocks: d.blocks
            .split("\n")
            .map((b) => b.trim())
            .filter(Boolean),
        }
      : {}),
    ...(d.useWeights ? { weights: Object.fromEntries(CRITERIA.map((c) => [c, Number(d.weights[c])])) } : {}),
    ...(d.sessionRules.trim() ? { sessionRules: d.sessionRules } : {}),
    ...(d.knowledge.trim() ? { knowledge: d.knowledge } : {}),
  };
}

function fromContent(c: Content): Draft {
  return {
    name: c.name,
    summary: c.summary ?? "",
    category: c.category ?? "other",
    mode: c.council?.mode ?? "",
    models: c.council?.models ? String(c.council.models) : "",
    roles: (c.roles ?? []) as CouncilRole[],
    blocks: (c.requirementBlocks ?? []).join("\n"),
    useWeights: Boolean(c.weights),
    weights: c.weights ? (Object.fromEntries(CRITERIA.map((k) => [k, String(c.weights![k] ?? 0)])) as Draft["weights"]) : EMPTY.weights,
    sessionRules: c.sessionRules ?? "",
    knowledge: c.knowledge ?? "",
    changelog: "",
  };
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** "Not taken over: run" after a save or import (#419) – the fields the server did not store. */
export function IgnoredFieldsNotice({ fields }: { fields: string[] }) {
  const t = useTranslations("skills");
  if (fields.length === 0) return null;
  return (
    <Alert tone="warning">
      <strong>{t("ignoredTitle", { fields: fields.join(", ") })}</strong> {t("ignoredText")}
    </Alert>
  );
}

export function SkillManager({
  skills,
  canWrite,
  limits,
  publishEnabled = false,
}: {
  skills: SkillRow[];
  canWrite: boolean;
  /** SkillHub submissions (#368), behind the server-side flag SKILLHUB_PUBLISH. */
  publishEnabled?: boolean;
  limits: { max: number | null; own: number; team: boolean };
}) {
  const t = useTranslations("skills");
  const tRoles = useTranslations("roleSuggestion.names");
  const tCriteria = useTranslations("skills.criteria");
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // #419: fields of a save or import that were not stored (unknown to the skill schema) – never dropped silently.
  const [ignored, setIgnored] = useState<string[]>([]);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; versions: VersionRow[] } | null>(null);
  const atLimit = limits.max !== null && limits.own >= limits.max;

  /** A skill of a newer schema gets a translated "update CONSYRION" (#419); other errors keep the server's message. */
  function errorMessage(err: unknown) {
    if (!(err instanceof ApiRequestError)) return t("error");
    const details = err.details as { reason?: string; schemaVersion?: number } | undefined;
    if (details?.reason === "newer_schema") return t("newerSchema", { version: details.schemaVersion ?? 0 });
    return err.message;
  }

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setIgnored([]);
    try {
      const result = (await action()) as { ignoredFields?: unknown } | undefined;
      if (done) setNotice(done);
      const fields = result?.ignoredFields;
      if (Array.isArray(fields)) setIgnored(fields.filter((f): f is string => typeof f === "string"));
      router.refresh();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function edit(id: string) {
    setError(null);
    try {
      const { content } = await fetchJson<{ content: Content }>(`/api/skills/${encodeURIComponent(id)}`);
      setEditing({ id, draft: fromContent(content) });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
    }
  }

  async function save() {
    if (!editing) return;
    const content = toContent(editing.draft);
    const ok = await run(
      () =>
        editing.id
          ? fetchJson(`/api/skills/${encodeURIComponent(editing.id)}`, {
              method: "PUT",
              body: JSON.stringify({ content, ...(editing.draft.changelog.trim() ? { changelog: editing.draft.changelog } : {}) }),
            })
          : fetchJson("/api/skills", { method: "POST", body: JSON.stringify({ content }) }),
      t("saved"),
    );
    if (ok) setEditing(null);
  }

  async function exportSkill(id: string) {
    try {
      const { files } = await fetchJson<{ files: { "SKILL.md": string; "skill.json": string } }>(`/api/skills/${encodeURIComponent(id)}/export`);
      download("skill.json", files["skill.json"], "application/json");
      download("SKILL.md", files["SKILL.md"], "text/markdown");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
    }
  }

  async function toggleHistory(id: string) {
    if (history?.id === id) return setHistory(null);
    setError(null);
    try {
      const { versions } = await fetchJson<{ versions: VersionRow[] }>(`/api/skills/${encodeURIComponent(id)}/versions`);
      setHistory({ id, versions });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
    }
  }

  async function duplicate(s: SkillRow) {
    await run(
      () => fetchJson(`/api/skills/${encodeURIComponent(s.id)}/duplicate`, { method: "POST", body: JSON.stringify({ name: t("copyName", { name: s.name }) }) }),
      t("duplicated", { name: s.name }),
    );
  }

  async function importFile(file: File) {
    const text = await file.text();
    await run(() => fetchJson("/api/skills/import", { method: "POST", body: JSON.stringify({ skillJson: text }) }), t("imported"));
  }

  const own = skills.filter((s) => s.visibility !== "official");
  const official = skills.filter((s) => s.visibility === "official");
  const d = editing?.draft;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const preview = d ? toContent(d) : null;

  const row = (s: SkillRow) => (
    <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <strong>{s.name}</strong>
          <Badge tone={s.visibility === "official" ? "accent" : s.visibility === "team" ? "success" : "neutral"}>{t(`visibility.${s.visibility}`)}</Badge>
          <span className="text-xs text-muted">{t("versionShort", { version: s.version })}</span>
          <HubStatusBadge hub={s.hub} />
        </span>
        <span className="mt-0.5 block text-sm text-muted">{s.summary}</span>
        {s.forkedFrom ? (
          <span className="mt-0.5 block text-xs text-muted">{t("forkedFrom", { name: s.forkedFrom.name, version: s.forkedFrom.version })}</span>
        ) : null}
        {history?.id === s.id ? (
          <ol className="mt-2 space-y-1 text-xs" aria-label={t("versionsLabel", { name: s.name })}>
            {history.versions.map((v) => (
              <li key={v.version}>
                <span className="font-medium">{t("versionShort", { version: v.version })}</span>
                {v.createdAt ? <span className="text-muted"> · {new Date(v.createdAt).toLocaleDateString()}</span> : null}
                <span className="text-muted"> · {v.changelog ?? t("noChangelog")}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {s.editable && canWrite ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => void edit(s.id)}>
              {t("edit")}
            </Button>
            {publishEnabled && s.hub?.latestStatus === "draft" ? (
              <Button variant="secondary" disabled={busy} aria-expanded={publishing === s.id} onClick={() => setPublishing(publishing === s.id ? null : s.id)}>
                {t("hub.publish")}
              </Button>
            ) : null}
            {s.hub && s.hub.publicVersion !== null ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void run(() => fetchJson(`/api/skills/${encodeURIComponent(s.id)}/withdraw`, { method: "POST" }), t("hub.withdrawn"))}
              >
                {t("hub.withdraw")}
              </Button>
            ) : null}
            {s.visibility === "private" ? (
              <Button
                variant="secondary"
                disabled={busy || !limits.team}
                title={limits.team ? undefined : t("teamNeedsPro")}
                onClick={() => void run(() => fetchJson(`/api/skills/${s.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "team" }) }), t("shared"))}
              >
                {t("shareTeam")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(() => fetchJson(`/api/skills/${s.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "private" }) }), t("unshared"))
                }
              >
                {t("makePrivate")}
              </Button>
            )}
          </>
        ) : null}
        {!s.editable && canWrite ? (
          <Button variant="secondary" disabled={busy || atLimit} title={atLimit ? t("limitReached") : undefined} onClick={() => void duplicate(s)}>
            {t("duplicate")}
          </Button>
        ) : null}
        <Button variant="ghost" disabled={busy} aria-expanded={history?.id === s.id} onClick={() => void toggleHistory(s.id)}>
          {history?.id === s.id ? t("hideVersions") : t("versions")}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void exportSkill(s.id)}>
          {t("export")}
        </Button>
        {s.editable && canWrite ? (
          archiving === s.id ? (
            <>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void run(() => fetchJson(`/api/skills/${s.id}`, { method: "DELETE" }), t("archived")).then(() => setArchiving(null))}
              >
                {t("archiveConfirm")}
              </Button>
              <Button variant="ghost" onClick={() => setArchiving(null)}>
                {t("cancel")}
              </Button>
            </>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => setArchiving(s.id)}>
              {t("archive")}
            </Button>
          )
        ) : null}
      </span>
      {publishing === s.id ? <PublishPanel skill={s} onClose={() => setPublishing(null)} onDone={() => router.refresh()} /> : null}
    </li>
  );

  return (
    <div className="space-y-6">
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <IgnoredFieldsNotice fields={ignored} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{t("ownTitle")}</h2>
            <p className="mt-1 text-sm text-muted">{limits.max === null ? t("ownTextUnlimited") : t("ownText", { n: limits.own, max: limits.max })}</p>
          </div>
          {canWrite ? (
            <span className="flex flex-wrap items-center gap-2">
              <label className={`cursor-pointer text-sm text-primary hover:underline ${atLimit ? "pointer-events-none opacity-50" : ""}`}>
                {t("import")}
                <input
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  disabled={atLimit || busy}
                  onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])}
                />
              </label>
              <Button disabled={atLimit || busy} onClick={() => setEditing({ id: null, draft: EMPTY })}>
                {t("new")}
              </Button>
            </span>
          ) : null}
        </div>
        {atLimit ? <p className="mt-2 text-sm text-warning">{t("limitReached")}</p> : null}
        {own.length === 0 ? <p className="mt-3 text-sm text-muted">{t("noOwn")}</p> : <ul className="mt-2 divide-y divide-line">{own.map(row)}</ul>}
      </Card>

      {d && preview ? (
        <Card>
          <h2 className="font-semibold">{editing!.id ? t("editTitle") : t("newTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("editorHint")}</p>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <TextField label={t("field.name")} value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
              <TextAreaField label={t("field.summary")} value={d.summary} maxLength={400} rows={2} onChange={(e) => set({ summary: e.target.value })} />
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField label={t("field.category")} value={d.category} onChange={(e) => set({ category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`category.${c}`)}
                    </option>
                  ))}
                </SelectField>
                <SelectField label={t("field.mode")} value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
                  <option value="">{t("noSuggestion")}</option>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {DECISION_MODE_LABELS[m]}
                    </option>
                  ))}
                </SelectField>
                <SelectField label={t("field.models")} value={d.models} onChange={(e) => set({ models: e.target.value })}>
                  <option value="">{t("noSuggestion")}</option>
                  {Array.from({ length: MAX_PARTICIPANTS - MIN_PARTICIPANTS + 1 }, (_, i) => String(MIN_PARTICIPANTS + i)).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </SelectField>
              </div>
              <fieldset>
                <legend className="text-sm font-medium">{t("field.roles")}</legend>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {COUNCIL_ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={d.roles.includes(r)}
                        onChange={(e) => set({ roles: e.target.checked ? [...d.roles, r] : d.roles.filter((x) => x !== r) })}
                      />
                      {tRoles.has(r) ? tRoles(r) : r}
                    </label>
                  ))}
                </div>
              </fieldset>
              <TextAreaField
                label={t("field.blocks")}
                hint={t("field.blocksHint")}
                value={d.blocks}
                rows={4}
                onChange={(e) => set({ blocks: e.target.value })}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={d.useWeights} onChange={(e) => set({ useWeights: e.target.checked })} />
                {t("field.useWeights")}
              </label>
              {d.useWeights ? (
                <div className="grid gap-3 sm:grid-cols-5">
                  {CRITERIA.map((c) => (
                    <TextField
                      key={c}
                      label={tCriteria(c)}
                      type="number"
                      min={0}
                      max={100}
                      value={d.weights[c]}
                      onChange={(e) => set({ weights: { ...d.weights, [c]: e.target.value } })}
                    />
                  ))}
                </div>
              ) : null}
              <TextAreaField
                label={t("field.sessionRules")}
                value={d.sessionRules}
                maxLength={2000}
                rows={3}
                onChange={(e) => set({ sessionRules: e.target.value })}
              />
              <TextAreaField
                label={t("field.knowledge")}
                hint={t("field.knowledgeHint")}
                value={d.knowledge}
                maxLength={8000}
                rows={4}
                onChange={(e) => set({ knowledge: e.target.value })}
              />
              {editing!.id ? (
                <TextField
                  label={t("field.changelog")}
                  hint={t("field.changelogHint")}
                  value={d.changelog}
                  maxLength={500}
                  onChange={(e) => set({ changelog: e.target.value })}
                />
              ) : null}
              <div className="flex gap-2">
                <Button disabled={busy || !d.name.trim()} onClick={() => void save()}>
                  {t("save")}
                </Button>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  {t("cancel")}
                </Button>
              </div>
            </div>
            <div className="self-start rounded-xl border border-glass-line p-4 text-sm lg:sticky lg:top-6" data-testid="skill-preview">
              <h3 className="font-semibold">{t("previewTitle")}</h3>
              <p className="mt-1 text-xs text-muted">{t("previewHint")}</p>
              <dl className="mt-3 space-y-2">
                <div>
                  <dt className="text-muted">{t("field.mode")}</dt>
                  <dd>
                    {preview.council?.mode ? DECISION_MODE_LABELS[preview.council.mode as keyof typeof DECISION_MODE_LABELS] : t("noSuggestion")}
                    {preview.council?.models ? ` · ${t("modelsValue", { n: preview.council.models })}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{t("field.roles")}</dt>
                  <dd>{preview.roles?.length ? preview.roles.map((r) => (tRoles.has(r) ? tRoles(r) : r)).join(", ") : t("noSuggestion")}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t("previewBlocks")}</dt>
                  <dd>
                    {preview.requirementBlocks?.length ? (
                      <ul className="list-disc pl-5">
                        {preview.requirementBlocks.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    ) : (
                      t("noSuggestion")
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{t("previewWeights")}</dt>
                  <dd>{preview.weights ? CRITERIA.map((c) => `${tCriteria(c)} ${preview.weights![c]} %`).join(" · ") : t("modeDefault")}</dd>
                </div>
                {preview.sessionRules ? (
                  <div>
                    <dt className="text-muted">{t("field.sessionRules")}</dt>
                    <dd className="whitespace-pre-wrap">{preview.sessionRules}</dd>
                  </div>
                ) : null}
                {preview.knowledge ? (
                  <div>
                    <dt className="text-muted">{t("field.knowledge")}</dt>
                    <dd className="max-h-40 overflow-auto whitespace-pre-wrap">{preview.knowledge}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-3 text-xs text-muted">{t("safetyNote")}</p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <h2 className="font-semibold">{t("officialTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("officialText")}</p>
        <ul className="mt-2 divide-y divide-line">{official.map(row)}</ul>
      </Card>
    </div>
  );
}
