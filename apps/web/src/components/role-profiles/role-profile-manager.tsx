"use client";

import { COUNCIL_ROLES, type CouncilRole } from "@consyrion/core/browser";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "../ui/button";
import { SelectField, TextAreaField, TextField } from "../ui/field";
import { Alert, Badge, Card } from "../ui/surface";

/**
 * Settings → Role profiles (#270, Expert Library stage 1). A profile sharpens one of the twelve 12 Minds roles; it is a
 * perspective, never an extra model or vote. The server validates and scans every save; this form only collects.
 */

const SOURCE_STATUSES = ["own_statement", "unconfirmed", "verified", "outdated"] as const;
type SourceStatus = (typeof SOURCE_STATUSES)[number];

export interface RoleProfileRow {
  id: string;
  role: CouncilRole;
  name: string;
  coreQuestion: string;
  visibility: "private" | "team" | "curated";
  version: number;
  contentHash: string;
  editable: boolean;
  updatedAt: string | null;
}

interface Source {
  title: string;
  url: string | null;
  status: SourceStatus;
  checkedAt: string | null;
  note: string | null;
}

interface Content {
  role: CouncilRole;
  name: string;
  coreQuestion: string;
  lenses: string[];
  notSuitableFor: string;
  sources: Source[];
}

interface Draft {
  role: CouncilRole;
  name: string;
  coreQuestion: string;
  lenses: string;
  notSuitableFor: string;
  sources: Array<{ title: string; url: string; status: SourceStatus; checkedAt: string; note: string }>;
}

const EMPTY: Draft = { role: "software_architect", name: "", coreQuestion: "", lenses: "", notSuitableFor: "", sources: [] };

function toContent(d: Draft) {
  return {
    role: d.role,
    name: d.name,
    coreQuestion: d.coreQuestion,
    lenses: d.lenses
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    notSuitableFor: d.notSuitableFor,
    sources: d.sources
      .filter((s) => s.title.trim())
      .map((s) => ({ title: s.title, url: s.url.trim() || null, status: s.status, checkedAt: s.checkedAt.trim() || null, note: s.note.trim() || null })),
  };
}

function fromContent(c: Content): Draft {
  return {
    role: c.role,
    name: c.name,
    coreQuestion: c.coreQuestion,
    lenses: c.lenses.join("\n"),
    notSuitableFor: c.notSuitableFor,
    sources: c.sources.map((s) => ({ title: s.title, url: s.url ?? "", status: s.status, checkedAt: s.checkedAt ?? "", note: s.note ?? "" })),
  };
}

/** Read-only detail of a profile version: the guiding question, lenses, limits and sources with their status. */
export function RoleProfileDetail({ content }: { content: Content }) {
  const t = useTranslations("roleProfiles");
  return (
    <div className="mt-3 space-y-3 text-sm">
      <p>
        <span className="text-muted">{t("coreQuestion")}: </span>
        {content.coreQuestion}
      </p>
      <div>
        <p className="text-muted">{t("lenses")}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {content.lenses.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
      <p>
        <span className="text-muted">{t("notSuitableFor")}: </span>
        {content.notSuitableFor}
      </p>
      <div>
        <p className="text-muted">{t("sources")}</p>
        {content.sources.length === 0 ? (
          <p className="text-muted">{t("noSources")}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {content.sources.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Badge tone={s.status === "verified" ? "success" : s.status === "outdated" ? "warning" : "neutral"}>{t(`status.${s.status}`)}</Badge>
                {/* A link is shown as text, never fetched or opened automatically; the user follows it consciously. */}
                <span>{s.title}</span>
                {s.url ? <span className="break-all text-xs text-muted">{s.url}</span> : null}
                {s.checkedAt ? <span className="text-xs text-muted">{t("checkedAt", { date: s.checkedAt })}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RoleProfileManager({ profiles, canWrite, canShare }: { profiles: RoleProfileRow[]; canWrite: boolean; canShare: boolean }) {
  const t = useTranslations("roleProfiles");
  const tRoles = useTranslations("roleSuggestion.names");
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [open, setOpen] = useState<{ id: string; content: Content } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [archiving, setArchiving] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setIgnored([]);
    try {
      const result = (await action()) as { ignoredFields?: unknown } | undefined;
      if (done) setNotice(done);
      if (Array.isArray(result?.ignoredFields)) setIgnored(result.ignoredFields.filter((f): f is string => typeof f === "string"));
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function load(id: string) {
    const { snapshot } = await fetchJson<{ snapshot: { content: Content } }>(`/api/role-profiles/${encodeURIComponent(id)}`);
    return snapshot.content;
  }

  async function toggle(id: string) {
    if (open?.id === id) return setOpen(null);
    setError(null);
    try {
      setOpen({ id, content: await load(id) });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("error"));
    }
  }

  async function edit(id: string) {
    setError(null);
    try {
      setEditing({ id, draft: fromContent(await load(id)) });
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
          ? fetchJson(`/api/role-profiles/${encodeURIComponent(editing.id)}`, { method: "PUT", body: JSON.stringify({ content }) })
          : fetchJson("/api/role-profiles", { method: "POST", body: JSON.stringify({ content }) }),
      t("saved"),
    );
    if (ok) setEditing(null);
  }

  const d = editing?.draft;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const setSource = (i: number, patch: Partial<Draft["sources"][number]>) => set({ sources: d!.sources.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const own = profiles.filter((p) => p.visibility !== "curated");
  const curated = profiles.filter((p) => p.visibility === "curated");

  const row = (p: RoleProfileRow) => (
    <li key={p.id} className="py-3" data-testid="role-profile-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <strong>{p.name}</strong>
            <Badge tone={p.visibility === "curated" ? "accent" : p.visibility === "team" ? "success" : "neutral"}>{t(`visibility.${p.visibility}`)}</Badge>
            <span className="text-xs text-muted">{t("versionShort", { version: p.version })}</span>
          </span>
          <span className="mt-0.5 block text-xs text-muted">{t("forRole", { role: tRoles(p.role) })}</span>
          <span className="mt-0.5 block text-sm text-muted">{p.coreQuestion}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" disabled={busy} aria-expanded={open?.id === p.id} onClick={() => void toggle(p.id)}>
            {open?.id === p.id ? t("hide") : t("show")}
          </Button>
          {p.editable && canWrite ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void edit(p.id)}>
                {t("edit")}
              </Button>
              {p.visibility === "private" ? (
                <Button
                  variant="secondary"
                  disabled={busy || !canShare}
                  title={canShare ? undefined : t("shareNeedsAdmin")}
                  onClick={() =>
                    void run(() => fetchJson(`/api/role-profiles/${p.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "team" }) }), t("shared"))
                  }
                >
                  {t("shareTeam")}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => fetchJson(`/api/role-profiles/${p.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "private" }) }), t("unshared"))
                  }
                >
                  {t("makePrivate")}
                </Button>
              )}
              {archiving === p.id ? (
                <>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void run(() => fetchJson(`/api/role-profiles/${p.id}`, { method: "DELETE" }), t("archived")).then(() => setArchiving(null))}
                  >
                    {t("archiveConfirm")}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setArchiving(null)}>
                    {t("cancel")}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={() => setArchiving(p.id)}>
                  {t("archive")}
                </Button>
              )}
            </>
          ) : null}
        </span>
      </div>
      {open?.id === p.id ? <RoleProfileDetail content={open.content} /> : null}
    </li>
  );

  return (
    <div className="space-y-6">
      {/* Always visible (#270): a perspective is no independent model and no extra vote. */}
      <p role="note" className="rounded-lg border border-[#a78bfa]/40 bg-surface-2 px-4 py-3 text-sm" data-testid="perspective-not-model">
        {t("perspectiveNotModel")}
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {ignored.length ? (
        <Alert tone="warning">
          <strong>{t("ignoredTitle", { fields: ignored.join(", ") })}</strong>
        </Alert>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{t("own")}</h2>
          {canWrite && !editing ? (
            <Button onClick={() => setEditing({ id: null, draft: { ...EMPTY } })} disabled={busy}>
              {t("new")}
            </Button>
          ) : null}
        </div>
        {own.length === 0 ? <p className="mt-2 text-sm text-muted">{t("noOwn")}</p> : <ul className="mt-2 divide-y divide-glass-line">{own.map(row)}</ul>}
      </Card>

      {d ? (
        <Card>
          <h2 className="font-semibold">{editing!.id ? t("editTitle") : t("newTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("noPersons")}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <SelectField label={t("role")} value={d.role} onChange={(e) => set({ role: e.target.value as CouncilRole })}>
              {COUNCIL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {tRoles(r)}
                </option>
              ))}
            </SelectField>
            <TextField label={t("name")} value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="mt-4 space-y-4">
            <TextField label={t("coreQuestion")} value={d.coreQuestion} maxLength={300} onChange={(e) => set({ coreQuestion: e.target.value })} />
            <TextAreaField label={t("lenses")} hint={t("lensesHint")} rows={5} value={d.lenses} onChange={(e) => set({ lenses: e.target.value })} />
            <TextAreaField label={t("notSuitableFor")} rows={2} value={d.notSuitableFor} onChange={(e) => set({ notSuitableFor: e.target.value })} />
            <div>
              <p className="text-sm font-medium">{t("sources")}</p>
              <p className="text-xs text-muted">{t("sourcesHint")}</p>
              {d.sources.map((s, i) => (
                <div key={i} className="mt-3 grid gap-3 rounded-xl border border-glass-line p-3 md:grid-cols-2">
                  <TextField label={t("sourceTitle")} value={s.title} onChange={(e) => setSource(i, { title: e.target.value })} />
                  <SelectField label={t("sourceStatus")} value={s.status} onChange={(e) => setSource(i, { status: e.target.value as SourceStatus })}>
                    {SOURCE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {t(`status.${st}`)}
                      </option>
                    ))}
                  </SelectField>
                  {s.status !== "own_statement" ? (
                    <>
                      <TextField
                        label={t("sourceUrl")}
                        type="url"
                        placeholder="https://"
                        value={s.url}
                        onChange={(e) => setSource(i, { url: e.target.value })}
                      />
                      <TextField label={t("sourceCheckedAt")} type="date" value={s.checkedAt} onChange={(e) => setSource(i, { checkedAt: e.target.value })} />
                    </>
                  ) : null}
                  <div className="md:col-span-2">
                    <Button variant="ghost" onClick={() => set({ sources: d.sources.filter((_, j) => j !== i) })}>
                      {t("removeSource")}
                    </Button>
                  </div>
                </div>
              ))}
              {d.sources.length < 10 ? (
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => set({ sources: [...d.sources, { title: "", url: "", status: "own_statement", checkedAt: "", note: "" }] })}
                >
                  {t("addSource")}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy}>
              {t("save")}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              {t("cancel")}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <h2 className="font-semibold">{t("curated")}</h2>
        <p className="mt-1 text-sm text-muted">{t("curatedHint")}</p>
        <ul className="mt-2 divide-y divide-glass-line">{curated.map(row)}</ul>
      </Card>
    </div>
  );
}
