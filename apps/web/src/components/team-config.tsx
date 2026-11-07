"use client";

import {
  COUNCIL_ROLES,
  DECISION_MODE_LABELS,
  MAX_PARTICIPANTS,
  MAX_TOKEN_BUDGET,
  MIN_PARTICIPANTS,
  MIN_TOKEN_BUDGET,
  MODE_POLICIES,
  tokenBudgetError,
  weightFieldError,
  type CouncilRole,
  type DecisionMode,
  type EvaluationWeights,
  type RoleSuggestionResult,
  type StrengthSuggestion,
  type VoteWeightWarning,
} from "@consyrion/core/browser";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { TextAreaField } from "./ui/field";
import { Alert, Badge, Card } from "./ui/surface";
import { Select } from "./ui/select";
import { RoleSuggestionCard } from "./role-suggestion-card";
import { VoteWeights, voteWarningText, type VoteWeightRow } from "./vote-weights";

interface CredentialModels {
  credentialId: string;
  provider: "anthropic" | "openai" | "google" | "deepseek" | "glm" | "kimi" | "qwen" | "xai";
  label: string;
  models: { modelId: string; displayName: string; contextWindow: number | null; strength?: StrengthSuggestion; unavailableSince?: string | null }[];
  error: string | null;
}

interface Selected {
  credentialId: string;
  provider: string;
  modelId: string;
  displayName: string;
  /** Catalog suggestion from the model list (#139). */
  strength: StrengthSuggestion | null;
  /** The user's vote weight (#141); null = the suggestion. */
  voteWeight: number | null;
}

const suggestedWeight = (s: Selected) => s.strength?.tier ?? 5;

const PROVIDER_LABELS = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  google: "Google Gemini",
  deepseek: "DeepSeek",
  glm: "Z.ai (GLM)",
  kimi: "Moonshot (Kimi)",
  qwen: "Alibaba (Qwen)",
  xai: "xAI (Grok)",
} as const;

/** Mode order on screen; the names stay English (product terms), the descriptions come from `teamConfig.mode`. */
const MODES: DecisionMode[] = ["independent_expert", "adversarial_review", "consensus"];

/** Fallback when `roleSuggestion.names.<role>` is missing. */
const ROLE_LABEL = (role: string) => role.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Core returns English field errors (#97); they map to message keys here, unknown texts stay as they are. */
const WEIGHT_ERROR_KEYS: Record<string, string> = {
  "Enter a number from 0 to 100.": "weightError.enter",
  "Must not be negative.": "weightError.negative",
  "Must be at most 100.": "weightError.max",
};

const stringify = (weights: EvaluationWeights) =>
  Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, String(v)])) as Record<keyof EvaluationWeights, string>;

/** Final Verdict criteria in display order; labels come from `teamConfig.weight.<key>`. */
const WEIGHT_KEYS: Array<keyof EvaluationWeights> = ["technicalQuality", "security", "maintainability", "operatingCost", "implementationSpeed"];

interface Preview {
  estimate: { calls: number; upperBound: number; withinBudget: boolean; typical: { tokens: number; basedOnCalls: number } | null };
  documents: number;
  /** Server-side plan gate (#173): why the start would be refused, or null. */
  planLimit?: string | null;
  /** #228: whether each evaluator's Final Verdict fits into one call; refused when it does not, warned when tight. */
  finalVerdictSize?: { fits: boolean; tight: boolean; message: string | null };
  /** Models that failed often in this workspace's recent councils (#175). */
  modelWarnings?: string[];
  /** Dominant or far-off vote weights (#170), computed on the server (#189). */
  voteWeightWarnings?: VoteWeightWarning[];
}

/** Screen #38 – choose models from the live registry, roles, mode, rounds, budget and rules. */
export function TeamConfig({
  projectId,
  projectName,
  planName,
  maxModels: planMax,
  requirementsConfirmed,
  roleSuggestion,
}: {
  projectId: string;
  projectName: string;
  planName: string;
  maxModels: number;
  /** A requirement list matching the current brief and documents is confirmed (#190); the server checks it again. */
  requirementsConfirmed: boolean;
  /** Deterministic perspective suggestion for this project (#269); applied only by the user's click. */
  roleSuggestion?: RoleSuggestionResult;
}) {
  const maxModels = Math.max(MIN_PARTICIPANTS, Math.min(MAX_PARTICIPANTS, planMax));
  const t = useTranslations("teamConfig");
  const tRoles = useTranslations("roleSuggestion.names");
  const tVotes = useTranslations("voteWeights");
  const roleLabel = (role: string) => (tRoles.has(role) ? tRoles(role) : ROLE_LABEL(role));
  const format = useFormatter();
  const router = useRouter();
  const [registry, setRegistry] = useState<CredentialModels[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Selected[]>([]);
  const [mode, setMode] = useState<DecisionMode>("independent_expert");
  const [roles, setRoles] = useState<CouncilRole[]>(MODE_POLICIES.independent_expert.roles);
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [debateRounds, setDebateRounds] = useState(MODE_POLICIES.independent_expert.debateRounds);
  const [consensusRounds, setConsensusRounds] = useState(MODE_POLICIES.independent_expert.consensusRounds);
  const [allowHybrid, setAllowHybrid] = useState(MODE_POLICIES.independent_expert.allowHybrid);
  const [weights, setWeights] = useState<EvaluationWeights>(MODE_POLICIES.independent_expert.weights);
  // What the user typed, so an empty or negative field is not silently turned into a number (#97).
  const [weightInputs, setWeightInputs] = useState<Record<keyof EvaluationWeights, string>>(() => stringify(MODE_POLICIES.independent_expert.weights));
  const [tokenBudget, setTokenBudget] = useState(400_000);
  const [customRules, setCustomRules] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetchJson<{ credentials: CredentialModels[] }>("/api/models")
      .then((r) => setRegistry(r.credentials))
      .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : t("loadError")));
  }, []);

  function applyMode(next: DecisionMode) {
    const policy = MODE_POLICIES[next];
    setMode(next);
    setRoles(policy.roles);
    setDebateRounds(policy.debateRounds);
    setConsensusRounds(policy.consensusRounds);
    setAllowHybrid(policy.allowHybrid);
    setWeights(policy.weights);
    setWeightInputs(stringify(policy.weights));
    setAssignments({});
  }

  function toggleModel(entry: CredentialModels, model: CredentialModels["models"][number]) {
    setAssignments({});
    setSelected((current) => {
      const exists = current.some((s) => s.credentialId === entry.credentialId && s.modelId === model.modelId);
      if (exists) return current.filter((s) => !(s.credentialId === entry.credentialId && s.modelId === model.modelId));
      if (current.length >= 6) return current;
      return [
        ...current,
        {
          credentialId: entry.credentialId,
          provider: entry.provider,
          modelId: model.modelId,
          displayName: model.displayName,
          strength: model.strength ?? null,
          voteWeight: null,
        },
      ];
    });
  }

  const weightErrors = Object.fromEntries(
    WEIGHT_KEYS.map((key) => {
      const message = weightFieldError(weightInputs[key]);
      return [key, message && WEIGHT_ERROR_KEYS[message] ? t(WEIGHT_ERROR_KEYS[message]) : message];
    }),
  ) as Record<keyof EvaluationWeights, string | null>;
  const weightsValid = Object.values(weightErrors).every((e) => e === null);
  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  const body = useMemo(
    () => ({
      mode,
      // The weight shown is the weight used: the suggestion unless the user changed it (#141).
      participants: selected.map((s) => ({ credentialId: s.credentialId, modelId: s.modelId, voteWeight: s.voteWeight ?? suggestedWeight(s) })),
      roles,
      debateRounds,
      consensusRounds,
      allowHybrid,
      weights,
      tokenBudget,
      customRules,
      roleAssignments: selected.length > 0 ? roles.map((role, index) => ({ role, participantIndex: assignments[role] ?? index % selected.length })) : undefined,
    }),
    [mode, selected, roles, debateRounds, consensusRounds, allowHybrid, weights, tokenBudget, customRules, assignments],
  );

  useEffect(() => {
    if (selected.length < MIN_PARTICIPANTS || selected.length > maxModels || roles.length === 0 || weightTotal !== 100 || tokenBudgetError(tokenBudget)) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      fetchJson<Preview>(`/api/projects/${projectId}/sessions/preview`, { method: "POST", body: JSON.stringify(body) })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [body, projectId, selected.length, roles.length, weightTotal, maxModels, tokenBudget]);

  // The upper bound exceeds the budget: starting needs an explicit confirmation (#148).
  const overBudget = preview?.estimate.withinBudget === false;
  const [budgetConfirmed, setBudgetConfirmed] = useState(false);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const { session } = await fetchJson<{ session: { id: string } }>(`/api/projects/${projectId}/sessions`, {
        method: "POST",
        body: JSON.stringify({ ...body, confirmBudget: overBudget ? budgetConfirmed : undefined }),
      });
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      setStarting(false);
      setError(err instanceof ApiRequestError ? err.message : t("startError"));
    }
  }

  const voteRows: VoteWeightRow[] = selected.map((s) => ({
    key: `${s.credentialId}:${s.modelId}`,
    name: s.displayName,
    weight: s.voteWeight ?? suggestedWeight(s),
    suggestion: s.strength,
  }));
  // Not blocking (#170): the weights stay the user's choice, but a dominant or far-off weight is named before the start.
  const voteWarnings = preview?.voteWeightWarnings ?? [];

  const budgetError = tokenBudgetError(tokenBudget) ? t("budgetError", { min: format.number(MIN_TOKEN_BUDGET), max: format.number(MAX_TOKEN_BUDGET) }) : null;
  const problems = [
    requirementsConfirmed ? null : t("problem.requirements"),
    selected.length < MIN_PARTICIPANTS ? t("problem.minModels") : null,
    selected.length > maxModels ? t("problem.plan", { plan: planName, n: maxModels }) : null,
    preview?.planLimit ?? null,
    preview?.finalVerdictSize && !preview.finalVerdictSize.fits ? preview.finalVerdictSize.message : null,
    budgetError,
    roles.length === 0 ? t("problem.roles") : null,
    !weightsValid ? t("problem.weights") : weightTotal !== 100 ? t("problem.total", { total: weightTotal }) : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{t("models.title")}</h2>
            <p className="text-sm text-muted">
              {maxModels < MAX_PARTICIPANTS
                ? t("models.introPlan", { min: MIN_PARTICIPANTS, max: maxModels, plan: planName })
                : t("models.intro", { min: MIN_PARTICIPANTS, max: maxModels })}
            </p>
          </div>
          <Badge tone={selected.length >= 2 ? "success" : "warning"}>{t("models.selected", { n: selected.length, max: maxModels })}</Badge>
        </div>
        {loadError ? (
          <div className="mt-4">
            <Alert>{loadError}</Alert>
          </div>
        ) : null}
        {registry === null && !loadError ? (
          <p className="mt-4 text-sm text-muted" role="status">
            {t("models.loading")}
          </p>
        ) : null}
        {registry && registry.length === 0 ? (
          <div className="mt-4">
            <Alert tone="warning">
              {t.rich("models.noKeys", {
                link: (chunks) => (
                  <Link href="/settings/providers" className="underline">
                    {chunks}
                  </Link>
                ),
              })}
            </Alert>
          </div>
        ) : null}
        {registry && registry.length > 0 ? (
          <>
            <input
              type="search"
              placeholder={t("models.filter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={t("models.filter")}
              className="mt-4 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
            />
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {registry.map((entry) => (
                <div key={entry.credentialId}>
                  <p className="mb-2 text-sm font-medium">
                    {PROVIDER_LABELS[entry.provider]} <span className="text-muted">· {entry.label}</span>
                  </p>
                  {entry.error ? <p className="text-sm text-danger">{entry.error}</p> : null}
                  <ManualModel onAdd={(modelId) => toggleModel(entry, { modelId, displayName: modelId, contextWindow: null })} />
                  <ul className="max-h-64 space-y-1 overflow-auto pr-1">
                    {entry.models
                      .filter((m) => !filter || `${m.displayName} ${m.modelId}`.toLowerCase().includes(filter.toLowerCase()))
                      .map((model) => {
                        const checked = selected.some((s) => s.credentialId === entry.credentialId && s.modelId === model.modelId);
                        return (
                          <li key={model.modelId}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleModel(entry, model)}
                                disabled={!checked && selected.length >= maxModels}
                              />
                              <span className={`truncate ${model.unavailableSince ? "text-muted line-through" : ""}`} title={model.modelId}>
                                {model.displayName}
                              </span>
                              {model.unavailableSince ? (
                                <span className="ml-auto shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-xs text-warning" title={t("models.unavailableHint")}>
                                  {t("models.unavailableSince", {
                                    date: format.dateTime(new Date(model.unavailableSince), { dateStyle: "short", timeStyle: "short" }),
                                  })}
                                </span>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Card>

      <Card>
        <h2 className="font-semibold">{t("mode.title")}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => applyMode(m)}
              className="rounded-xl border border-line bg-surface-2 p-4 text-left hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/10"
            >
              <span className="font-medium">{DECISION_MODE_LABELS[m]}</span>
              <span className="mt-1 block text-sm text-muted">{t(`mode.${m}`)}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">{t("roles.title")}</h2>
        <p className="text-sm text-muted">{t("roles.intro", { n: roles.length })}</p>
        {roleSuggestion ? <RoleSuggestionCard suggestion={roleSuggestion} active={roles} onApply={setRoles} /> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {COUNCIL_ROLES.map((role) => {
            const active = roles.includes(role);
            const index = roles.indexOf(role);
            return (
              <div key={role} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={active} onChange={() => setRoles((r) => (active ? r.filter((x) => x !== role) : [...r, role]))} />
                  {roleLabel(role)}
                </label>
                {active && selected.length > 0 ? (
                  <Select
                    aria-label={t("roles.modelFor", { role: roleLabel(role) })}
                    value={assignments[role] ?? index % selected.length}
                    onChange={(e) => setAssignments((a) => ({ ...a, [role]: Number(e.target.value) }))}
                    className="w-[45%]"
                  >
                    {selected.map((s, i) => (
                      <option key={`${s.credentialId}:${s.modelId}`} value={i}>
                        {s.displayName}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">{t("settings.title")}</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <NumberSetting label={t("settings.debate")} value={debateRounds} min={1} max={3} onChange={setDebateRounds} />
          <NumberSetting label={t("settings.consensus")} value={consensusRounds} min={1} max={3} onChange={setConsensusRounds} />
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={allowHybrid} onChange={(e) => setAllowHybrid(e.target.checked)} />
            {t("settings.hybrid")}
          </label>
        </div>
        <div className="mt-5">
          <p className="text-sm font-medium">
            {t("settings.weights")}{" "}
            <span className={weightsValid && weightTotal === 100 ? "text-muted" : "text-danger"}>{t("settings.total", { total: weightTotal })}</span>
          </p>
          <div className="mt-2 grid gap-3 md:grid-cols-5">
            {WEIGHT_KEYS.map((key) => (
              <div key={key}>
                <label className="text-sm">
                  <span className="block text-muted">{t(`weight.${key}`)}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weightInputs[key]}
                    aria-invalid={weightErrors[key] ? true : undefined}
                    aria-describedby={weightErrors[key] ? `weight-${key}-error` : undefined}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setWeightInputs((w) => ({ ...w, [key]: raw }));
                      if (weightFieldError(raw) === null) setWeights((w) => ({ ...w, [key]: Number(raw) }));
                    }}
                    className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 aria-[invalid=true]:border-danger"
                  />
                </label>
                {weightErrors[key] ? (
                  <span id={`weight-${key}-error`} className="mt-1 block text-xs text-danger" aria-live="polite">
                    {weightErrors[key]}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="block font-medium">{t("settings.budget")}</span>
            <input
              type="number"
              min={MIN_TOKEN_BUDGET}
              max={MAX_TOKEN_BUDGET}
              step={10_000}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(Number(e.target.value))}
              aria-invalid={Boolean(budgetError)}
              aria-describedby="token-budget-help"
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 aria-[invalid=true]:border-danger"
            />
            <span id="token-budget-help" className={`mt-1 block ${budgetError ? "text-danger" : "text-muted"}`}>
              {budgetError ?? t("settings.budgetHint", { min: format.number(MIN_TOKEN_BUDGET), max: format.number(MAX_TOKEN_BUDGET) })}
            </span>
          </label>
          <TextAreaField
            label={t("settings.rules")}
            name="rules"
            value={customRules}
            onChange={(e) => setCustomRules(e.target.value)}
            maxLength={2000}
            hint={t("settings.rulesHint")}
          />
        </div>
      </Card>

      {selected.length > 0 ? (
        <VoteWeights
          rows={voteRows}
          onChange={(key, weight) =>
            setSelected((current) => current.map((s) => (`${s.credentialId}:${s.modelId}` === key ? { ...s, voteWeight: weight } : s)))
          }
          onSuggest={() => setSelected((current) => current.map((s) => ({ ...s, voteWeight: null })))}
          onEqual={() => setSelected((current) => current.map((s) => ({ ...s, voteWeight: 5 })))}
          warnings={voteWarnings}
        />
      ) : null}

      <Card>
        <h2 className="font-semibold">{t("summary.title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("summary.project", { name: projectName })}</p>
        {preview ? (
          <p className="mt-2 text-sm">
            {t.rich(preview.documents ? "summary.estimateDocs" : "summary.estimate", {
              calls: preview.estimate.calls,
              tokens: format.number(preview.estimate.upperBound),
              docs: preview.documents,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}{" "}
            {preview.estimate.typical
              ? t("summary.typical", { tokens: format.number(preview.estimate.typical.tokens), calls: preview.estimate.typical.basedOnCalls })
              : t("summary.noTypical")}
          </p>
        ) : null}
        {preview?.finalVerdictSize?.fits && preview.finalVerdictSize.tight && preview.finalVerdictSize.message ? (
          <p className="mt-2 text-sm text-warning" data-testid="final-verdict-size">
            {preview.finalVerdictSize.message}
          </p>
        ) : null}
        {selected.length === MIN_PARTICIPANTS ? (
          <p className="mt-2 text-sm text-warning" data-testid="review-breadth">
            {t("summary.twoModels")}
          </p>
        ) : null}
        {preview?.modelWarnings?.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-warning" aria-label={t("summary.failedOften")}>
            {preview.modelWarnings.map((w) => (
              <li key={w}>{t("summary.failedRecently", { model: w })}</li>
            ))}
          </ul>
        ) : null}
        {overBudget ? (
          <label className="mt-3 flex items-start gap-2 text-sm text-warning">
            <input type="checkbox" className="mt-1" checked={budgetConfirmed} onChange={(e) => setBudgetConfirmed(e.target.checked)} />
            <span>{t("summary.overBudget", { budget: format.number(tokenBudget) })}</span>
          </label>
        ) : null}
        {problems.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-warning">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        {voteWarnings.length ? (
          <div className="mt-3">
            <Alert tone="warning">
              <p className="font-medium">{t("summary.checkWeights")}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {voteWarnings.map((w) => (
                  <li key={`${w.kind}-${w.index}`}>
                    {voteWarningText(
                      tVotes,
                      w,
                      voteRows.map((r) => r.name),
                    )}
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        ) : null}
        {error ? (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        ) : null}
        <Button className="mt-4" onClick={() => void start()} disabled={starting || problems.length > 0 || (overBudget && !budgetConfirmed)}>
          {starting ? t("starting") : t("start")}
        </Button>
      </Card>
    </div>
  );
}

function NumberSetting({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const t = useTranslations("teamConfig");
  return (
    <div className="text-sm">
      <span className="block font-medium">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <Button type="button" variant="secondary" className="px-3" onClick={() => onChange(Math.max(min, value - 1))} aria-label={t("decrease", { label })}>
          −
        </Button>
        <span className="w-8 text-center" aria-live="polite">
          {value}
        </span>
        <Button type="button" variant="secondary" className="px-3" onClick={() => onChange(Math.min(max, value + 1))} aria-label={t("increase", { label })}>
          +
        </Button>
      </div>
    </div>
  );
}

/** For providers whose model list is unavailable: add a model id from the provider's documentation. */
function ManualModel({ onAdd }: { onAdd: (modelId: string) => void }) {
  const t = useTranslations("teamConfig");
  const [value, setValue] = useState("");
  return (
    <div className="mb-2 flex gap-2">
      <input
        aria-label={t("manual.label")}
        placeholder={t("manual.placeholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs"
      />
      <Button
        type="button"
        variant="secondary"
        className="px-2 py-1 text-xs"
        disabled={!value.trim()}
        onClick={() => {
          onAdd(value.trim());
          setValue("");
        }}
      >
        {t("manual.add")}
      </Button>
    </div>
  );
}
