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
  type StrengthSuggestion,
  type VoteWeightWarning,
} from "@consyrion/core/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "./ui/button";
import { TextAreaField } from "./ui/field";
import { Alert, Badge, Card } from "./ui/surface";
import { Select } from "./ui/select";
import { VoteWeights, type VoteWeightRow } from "./vote-weights";

interface CredentialModels {
  credentialId: string;
  provider: "anthropic" | "openai" | "google" | "deepseek" | "glm" | "kimi" | "qwen" | "xai";
  label: string;
  models: { modelId: string; displayName: string; contextWindow: number | null; strength?: StrengthSuggestion }[];
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

const MODE_TEXT: Record<DecisionMode, string> = {
  independent_expert: "Blind expert proposals with lighter structured feedback. Architecture, strategy, technology choice.",
  adversarial_review: "Deep 12 Minds scrutiny, rebuttals, two independent judges per objection. Security and high-stakes decisions.",
  consensus: "Several revision passes and an optional hybrid proposal. Dissent stays documented.",
};

const ROLE_LABEL = (role: string) => role.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

const stringify = (weights: EvaluationWeights) =>
  Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, String(v)])) as Record<keyof EvaluationWeights, string>;

const WEIGHT_LABELS: Record<keyof EvaluationWeights, string> = {
  technicalQuality: "Technical quality",
  security: "Security",
  maintainability: "Maintainability",
  operatingCost: "Operating cost",
  implementationSpeed: "Implementation speed",
};

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
}: {
  projectId: string;
  projectName: string;
  planName: string;
  maxModels: number;
  /** A requirement list matching the current brief and documents is confirmed (#190); the server checks it again. */
  requirementsConfirmed: boolean;
}) {
  const maxModels = Math.max(MIN_PARTICIPANTS, Math.min(MAX_PARTICIPANTS, planMax));
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
      .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : "Could not load models"));
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
    (Object.keys(WEIGHT_LABELS) as Array<keyof EvaluationWeights>).map((key) => [key, weightFieldError(weightInputs[key])]),
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
      setError(err instanceof ApiRequestError ? err.message : "Could not start the session");
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

  const budgetError = tokenBudgetError(tokenBudget);
  const problems = [
    requirementsConfirmed ? null : "Confirm the hard requirements above before starting.",
    selected.length < MIN_PARTICIPANTS ? "Select at least two models." : null,
    selected.length > maxModels ? `Your ${planName} plan allows up to ${maxModels} models per session.` : null,
    preview?.planLimit ?? null,
    preview?.finalVerdictSize && !preview.finalVerdictSize.fits ? preview.finalVerdictSize.message : null,
    budgetError,
    roles.length === 0 ? "Activate at least one 12 Minds Council role." : null,
    !weightsValid
      ? "Fix the highlighted Final Verdict weights (each 0–100)."
      : weightTotal !== 100
        ? `Weights must add up to 100 (currently ${weightTotal}).`
        : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">1. Select AI models</h2>
            <p className="text-sm text-muted">
              Loaded live from your providers. Choose {MIN_PARTICIPANTS}–{maxModels} models
              {maxModels < MAX_PARTICIPANTS ? ` (limit of your ${planName} plan)` : ""}; different providers give more independent views.
            </p>
          </div>
          <Badge tone={selected.length >= 2 ? "success" : "warning"}>
            {selected.length} / {maxModels} selected
          </Badge>
        </div>
        {loadError ? (
          <div className="mt-4">
            <Alert>{loadError}</Alert>
          </div>
        ) : null}
        {registry === null && !loadError ? (
          <p className="mt-4 text-sm text-muted" role="status">
            Loading models from your providers…
          </p>
        ) : null}
        {registry && registry.length === 0 ? (
          <div className="mt-4">
            <Alert tone="warning">
              No API keys yet.{" "}
              <Link href="/settings/providers" className="underline">
                Add a provider key
              </Link>{" "}
              first.
            </Alert>
          </div>
        ) : null}
        {registry && registry.length > 0 ? (
          <>
            <input
              type="search"
              placeholder="Filter models"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter models"
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
                              <span className="truncate" title={model.modelId}>
                                {model.displayName}
                              </span>
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
        <h2 className="font-semibold">2. Decision mode</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {(Object.keys(MODE_TEXT) as DecisionMode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => applyMode(m)}
              className="rounded-xl border border-line bg-surface-2 p-4 text-left hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/10"
            >
              <span className="font-medium">{DECISION_MODE_LABELS[m]}</span>
              <span className="mt-1 block text-sm text-muted">{MODE_TEXT[m]}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">3. 12 Minds Council perspectives</h2>
        <p className="text-sm text-muted">
          {roles.length} active. Perspectives are not independent votes: majorities are counted per model. Fewer roles cost less.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {COUNCIL_ROLES.map((role) => {
            const active = roles.includes(role);
            const index = roles.indexOf(role);
            return (
              <div key={role} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={active} onChange={() => setRoles((r) => (active ? r.filter((x) => x !== role) : [...r, role]))} />
                  {ROLE_LABEL(role)}
                </label>
                {active && selected.length > 0 ? (
                  <Select
                    aria-label={`Model for ${ROLE_LABEL(role)}`}
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
        <h2 className="font-semibold">4. Session settings</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <NumberSetting label="Debate rounds" value={debateRounds} min={1} max={3} onChange={setDebateRounds} />
          <NumberSetting label="Consensus revision passes" value={consensusRounds} min={1} max={3} onChange={setConsensusRounds} />
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={allowHybrid} onChange={(e) => setAllowHybrid(e.target.checked)} />
            Allow a hybrid proposal (reviewed like any other)
          </label>
        </div>
        <div className="mt-5">
          <p className="text-sm font-medium">
            Final Verdict weights <span className={weightsValid && weightTotal === 100 ? "text-muted" : "text-danger"}>(total {weightTotal} %)</span>
          </p>
          <div className="mt-2 grid gap-3 md:grid-cols-5">
            {(Object.keys(WEIGHT_LABELS) as Array<keyof EvaluationWeights>).map((key) => (
              <div key={key}>
                <label className="text-sm">
                  <span className="block text-muted">{WEIGHT_LABELS[key]}</span>
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
            <span className="block font-medium">Token budget (hard limit)</span>
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
              {budgetError ??
                `${MIN_TOKEN_BUDGET.toLocaleString("en-US")}–${MAX_TOKEN_BUDGET.toLocaleString("en-US")} tokens. Calls stop when the budget would be exceeded. Providers bill your own keys.`}
            </span>
          </label>
          <TextAreaField
            label="Session rules (optional)"
            name="rules"
            value={customRules}
            onChange={(e) => setCustomRules(e.target.value)}
            maxLength={2000}
            hint="E.g. “Focus on operating cost” or “Must run in the EU”."
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
        <h2 className="font-semibold">Before you start</h2>
        <p className="mt-1 text-sm text-muted">Project: {projectName}</p>
        {preview ? (
          <p className="mt-2 text-sm">
            About <strong>{preview.estimate.calls}</strong> model calls in total, at most <strong>{preview.estimate.upperBound.toLocaleString("en-US")}</strong>{" "}
            tokens (upper bound)
            {preview.documents ? `, including ${preview.documents} attached document(s)` : ""}.{" "}
            {preview.estimate.typical
              ? `Typically about ${preview.estimate.typical.tokens.toLocaleString("en-US")} tokens (median of your last ${preview.estimate.typical.basedOnCalls} calls).`
              : "No typical value yet: too few earlier calls in this workspace."}
          </p>
        ) : null}
        {preview?.finalVerdictSize?.fits && preview.finalVerdictSize.tight && preview.finalVerdictSize.message ? (
          <p className="mt-2 text-sm text-warning" data-testid="final-verdict-size">
            {preview.finalVerdictSize.message}
          </p>
        ) : null}
        {selected.length === MIN_PARTICIPANTS ? (
          <p className="mt-2 text-sm text-warning" data-testid="review-breadth">
            With two models each proposal has only one independent evaluator: this council can name a provisional favourite, but never a recommendation you can
            approve. Choose three or more models for a recommendation.
          </p>
        ) : null}
        {preview?.modelWarnings?.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-warning" aria-label="Models that failed often">
            {preview.modelWarnings.map((w) => (
              <li key={w}>Often failed recently – {w}.</li>
            ))}
          </ul>
        ) : null}
        {overBudget ? (
          <label className="mt-3 flex items-start gap-2 text-sm text-warning">
            <input type="checkbox" className="mt-1" checked={budgetConfirmed} onChange={(e) => setBudgetConfirmed(e.target.checked)} />
            <span>
              The upper bound exceeds your budget of {tokenBudget.toLocaleString("en-US")} tokens. I accept that debate phases may be shortened to keep enough
              budget for the Final Verdict: if the budget runs short, Minority Review and Consensus Round are dropped and the proposals are not revised – the
              verdict then judges the first versions and is marked as shortened.
            </span>
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
              <p className="font-medium">Check the vote weights before you start:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {voteWarnings.map((w) => (
                  <li key={`${w.kind}-${w.index}`}>{w.message}</li>
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
          {starting ? "Starting…" : "Start council session"}
        </Button>
      </Card>
    </div>
  );
}

function NumberSetting({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="text-sm">
      <span className="block font-medium">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <Button type="button" variant="secondary" className="px-3" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Decrease ${label}`}>
          −
        </Button>
        <span className="w-8 text-center" aria-live="polite">
          {value}
        </span>
        <Button type="button" variant="secondary" className="px-3" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`Increase ${label}`}>
          +
        </Button>
      </div>
    </div>
  );
}

/** For providers whose model list is unavailable: add a model id from the provider's documentation. */
function ManualModel({ onAdd }: { onAdd: (modelId: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="mb-2 flex gap-2">
      <input
        aria-label="Model id"
        placeholder="Add model id manually"
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
        Add
      </Button>
    </div>
  );
}
