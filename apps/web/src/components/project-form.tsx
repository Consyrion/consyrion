"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { SelectField, TextAreaField, TextField } from "./ui/field";
import { Alert } from "./ui/surface";

type Source = "idea" | "repository" | "example";

const DRAFT_KEY = "consyrion-project-draft";
const IDEA_MAX = 20_000;

/** Example brief; its texts come from `projectForm.example` in the interface language. */
const EXAMPLE_TYPE = "architecture";

interface Draft {
  source: Source;
  name: string;
  type: string;
  intent: string;
  idea: string;
  goal: string;
  requirements: string;
  repositoryUrl: string;
}

const EMPTY: Draft = { source: "idea", name: "", type: "architecture", intent: "decision", idea: "", goal: "", requirements: "", repositoryUrl: "" };

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

/**
 * Screen #37 – project creation. The form autosaves to this browser while typing; "Save draft"
 * stores the project as draft on the server, "Continue" stores it as ready and opens the AI team
 * configuration (#38). Documents are uploaded on the next screen once the project exists.
 */
export function ProjectForm() {
  const t = useTranslations("projectForm");
  const format = useFormatter();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [restored, setRestored] = useState(false);
  const [pending, setPending] = useState<"draft" | "ready" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const saved = loadDraft();
    setDraft(saved);
    setRestored(saved !== EMPTY && Boolean(saved.idea || saved.name));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* autosave is a convenience; the form still works without storage */
    }
  }, [draft]);

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: event.target.value }));

  function chooseSource(source: Source) {
    if (source === "example")
      setDraft((d) => ({
        ...d,
        name: t("example.name"),
        type: EXAMPLE_TYPE,
        idea: t("example.idea"),
        goal: t("example.goal"),
        requirements: t("example.requirements"),
        source: "idea",
      }));
    else setDraft((d) => ({ ...d, source, type: source === "repository" ? "repository" : d.type }));
  }

  async function submit(status: "draft" | "ready") {
    setPending(status);
    setError(null);
    setFieldErrors({});
    try {
      const { project } = await fetchJson<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name,
          type: draft.type,
          intent: draft.intent,
          status,
          brief: { idea: draft.idea, goal: draft.goal, requirements: draft.requirements, repositoryUrl: draft.repositoryUrl.trim() || null },
        }),
      });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      router.push(status === "ready" ? `/projects/${project.id}/council/new` : `/projects/${project.id}`);
      router.refresh();
    } catch (err) {
      setPending(null);
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else setError(t("saveError"));
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("ready");
  }

  const fieldError = (key: string) => fieldErrors[key]?.[0];
  const ideaTooShort = draft.idea.trim().length > 0 && draft.idea.trim().length < 20;

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-6" noValidate>
      {restored ? <Alert tone="success">{t("restored")}</Alert> : null}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("source")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["idea", t("sourceIdea")],
              ["repository", t("sourceRepository")],
              ["example", t("sourceExample")],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseSource(value)}
              aria-pressed={value !== "example" && draft.source === value}
              className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/15"
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <TextField label={t("name")} name="name" value={draft.name} onChange={set("name")} required minLength={2} maxLength={120} error={fieldError("name")} />

      {draft.source === "repository" ? (
        <TextField
          label={t("sourceRepository")}
          name="repositoryUrl"
          type="url"
          value={draft.repositoryUrl}
          onChange={set("repositoryUrl")}
          placeholder="https://github.com/owner/repo"
          hint={t("repositoryHint")}
          error={fieldError("brief")}
        />
      ) : null}

      <div>
        <TextAreaField
          label={t("idea")}
          name="idea"
          value={draft.idea}
          onChange={set("idea")}
          required
          maxLength={IDEA_MAX}
          rows={7}
          hint={t("ideaHint")}
          error={ideaTooShort ? t("ideaTooShort") : fieldError("brief")}
        />
        <p className="mt-1 text-right text-xs text-muted" aria-live="polite">
          {format.number(draft.idea.length)} / {format.number(IDEA_MAX)}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label={t("type")} name="type" value={draft.type} onChange={set("type")} error={fieldError("type")}>
          <option value="idea">{t("types.idea")}</option>
          <option value="architecture">{t("types.architecture")}</option>
          <option value="repository">{t("types.repository")}</option>
          <option value="business">{t("types.business")}</option>
          <option value="technology_choice">{t("types.technology_choice")}</option>
        </SelectField>
        <SelectField label={t("intent")} name="intent" value={draft.intent} onChange={set("intent")} hint={t("intentHint")}>
          <option value="decision">{t("intents.decision")}</option>
          <option value="build">{t("intents.build")}</option>
          <option value="both">{t("intents.both")}</option>
        </SelectField>
      </div>

      <TextAreaField label={t("goal")} name="goal" value={draft.goal} onChange={set("goal")} hint={t("goalHint")} />
      <TextAreaField label={t("requirements")} name="requirements" value={draft.requirements} onChange={set("requirements")} hint={t("requirementsHint")} />

      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending !== null || ideaTooShort}>
          {pending === "ready" ? t("saving") : t("continue")}
        </Button>
        <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => void submit("draft")}>
          {pending === "draft" ? t("saving") : t("saveDraft")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setDraft(EMPTY);
            setRestored(false);
          }}
        >
          {t("clear")}
        </Button>
      </div>
    </form>
  );
}
