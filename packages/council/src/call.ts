import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_RETRY, ProviderError, timeoutSignal, withRetry, type ProviderAdapter, type TokenUsage } from "@consyrium/ai";
import { callTimeoutFor, DomainError, fitCallToModel, MAX_CALL_OUTPUT_TOKENS, outputTokensFor, redactSecrets } from "@consyrium/core";
import { newId, schema } from "@consyrium/db";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Participant, SessionContext } from "./context";
import { stablePrompt } from "./prompts";
import { toProviderJsonSchema } from "./schemas";

export class CancelledError extends Error {
  constructor() {
    super("Session was cancelled");
    this.name = "CancelledError";
  }
}

/**
 * Why a call failed, stored with its usage row and shown per model in the Council Room (#175). Provider-side kinds
 * say the model is not working right now; the others say one answer was unusable.
 */
export type CallErrorKind =
  | "timeout"
  | "rate_limit"
  | "overloaded"
  | "network"
  | "auth"
  | "model_not_found"
  | "bad_request"
  | "provider_error"
  | "credential"
  | "schema"
  | "mismatch"
  | "max_tokens"
  | "runaway"
  | "refusal"
  /** #243: the input leaves no room for an answer in this model's context window; the call is not sent. */
  | "context_window";

/** Kinds that mean the provider or model failed, not one answer: they count towards the phase failure limit. */
export const PROVIDER_FAILURE_KINDS: ReadonlySet<CallErrorKind> = new Set([
  "timeout",
  "rate_limit",
  "overloaded",
  "network",
  "auth",
  "model_not_found",
  "bad_request",
  "provider_error",
  "credential",
]);

type RepairKind = "max_tokens" | "runaway" | "invalid_output" | "mismatch" | "timeout";

/** A participant could not deliver a usable answer for one step; the run decides whether it can continue. */
export class ParticipantCallError extends Error {
  readonly kind: CallErrorKind;
  /** Set when one corrective retry may fix the answer (cut off, repeating, wrong structure or no answer in time). */
  readonly repair?: { kind: RepairKind; detail: string };
  /** The provider was overloaded or rate-limited after the quick retries: one late retry may succeed (#146). */
  readonly transient: boolean;
  readonly httpStatus?: number;
  constructor(
    readonly participantId: string,
    readonly reason: string,
    options: { kind: CallErrorKind; repair?: { kind: RepairKind; detail: string }; transient?: boolean; httpStatus?: number },
  ) {
    super(reason);
    this.name = "ParticipantCallError";
    this.kind = options.kind;
    this.repair = options.repair;
    this.transient = options.transient ?? false;
    this.httpStatus = options.httpStatus;
  }
}

export type AdapterResolver = (participant: Participant) => Promise<ProviderAdapter>;

type Phase = (typeof schema.councilPhase.enumValues)[number];

const CHARS_PER_TOKEN = 4;

type StructuredRequest<T extends z.ZodType> = {
  system: string;
  prompt: string;
  schemaName: string;
  schema: T;
  /** Content check after schema validation; a returned message rejects the answer like a schema error (#93). */
  check?: (value: z.output<T>) => string | null;
  /**
   * Replaces `check` on the corrective retry: a milder rule under which the caller keeps only the parts of the
   * answer that pass (#145: one mixed-up proposal must not discard an evaluator's other scores).
   */
  repairCheck?: (value: z.output<T>) => string | null;
  /** Proposals, questions, critiques or objections the answer covers: its output limit grows with them (#172). */
  items?: number;
};

/** Longest output a repair attempt may request after the first answer was cut off (= the policy maximum). */
const MAX_REPAIR_OUTPUT_TOKENS = MAX_CALL_OUTPUT_TOKENS;

/**
 * Wall-clock cap of one call including all its follow-ups (late retry, repairs), as a multiple of its timeout
 * (#175): Gemini 3.5 Flash ran timeout → longer repair → last attempt per role and per step, and one phase waited
 * 50+ minutes for a single model. A follow-up starts only if a useful share of a timeout is left, and never waits
 * longer than what is left.
 */
export const CALL_DEADLINE_FACTOR = 2.5;
const MIN_FOLLOW_UP_SHARE = 0.25;

/**
 * Provider-side failures of one model in one phase after which its remaining calls of that phase are not sent
 * (#175): the role or step is marked failed and the phase continues without waiting for a model that is down.
 */
export const PHASE_FAILURE_LIMIT = 2;

/** A repair attempt after a timeout waits this much longer than the first one. */
const TIMEOUT_REPAIR_FACTOR = 1.5;

/**
 * Wait before the one late retry after an overloaded provider (503) or a rate limit (#146). The quick transient
 * retries of `withRetry` cover a few seconds only; other models of the same phase usually still work for minutes,
 * so a later attempt costs no extra wall-clock time.
 */
export const TRANSIENT_RETRY_DELAY_MS = 45_000;

/** Longest single sleep while waiting for the late retry: cancellation is noticed at least this often. */
const WAIT_SLICE_MS = 5_000;

function repairNote(repair: NonNullable<ParticipantCallError["repair"]>) {
  switch (repair.kind) {
    case "max_tokens":
      return "Your previous answer was cut off at the output limit. Answer again, complete and more concise: keep every text field to a few sentences.";
    case "runaway":
      return "Your previous answer kept repeating the same text until it was cut off at the output limit. Answer again from the start: state each point once, keep every text field to at most three sentences and every list to at most seven entries, and stop as soon as the JSON object is complete.";
    case "timeout":
      return "Your previous answer did not arrive in time. Answer again, complete but noticeably more concise.";
    case "mismatch":
      return `Your previous answer mixed up the proposals (${repair.detail}). Proposal labels are not the options named in the brief. Answer again: copy each proposal's own title exactly into proposalTitle, and base every score only on that proposal.`;
    case "invalid_output":
      return `Your previous answer did not match the required JSON structure (${repair.detail}). Answer again and follow the schema exactly.`;
  }
}

/**
 * Cheap check whether an answer cut off at the output limit is a runaway (#175) – a model stuck repeating the same
 * passage or padding with whitespace – rather than an answer that is merely long. Only the raw text is looked at:
 * DeepSeek Flash wrote 8,000 and then 16,000 output tokens for one proposal on a 2,000-token prompt, so doubling the
 * limit only doubled the cost.
 */
export function looksRepetitive(text: string): boolean {
  if (text.length < 1_000) return false;
  const tail = text.slice(-6_000);
  // Whitespace padding: most of the end is blank.
  if (tail.replace(/\s+/g, "").length < tail.length * 0.2) return true;
  // The same passage again and again: a slice near the end occurs many times in the whole text.
  const probe = tail.slice(-160, -80);
  if (probe.trim().length >= 40) {
    let count = 0;
    for (let at = text.indexOf(probe); at !== -1 && count < 4; at = text.indexOf(probe, at + 1)) count += 1;
    if (count >= 4) return true;
  }
  // Few distinct sentences or list entries among many.
  const parts = tail
    .split(/\n+|(?<=[.!?])\s+|",\s*"/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20);
  return parts.length >= 12 && new Set(parts).size * 2 < parts.length;
}

/** Sleeps in slices and stops early when the session is cancelled. */
async function waitUnlessCancelled(ctx: SessionContext, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(WAIT_SLICE_MS, until - Date.now())));
    const session = await ctx.reload();
    if (session.status === "cancel_requested" || session.status === "cancelled") throw new CancelledError();
  }
}

/**
 * Every model call of the engine goes through here: cancellation check, server-side budget check,
 * retries for transient errors, timeout, usage recording and schema validation. An answer that was
 * cut off, does not match the schema or did not arrive within the call timeout gets one corrective
 * retry; each attempt is budgeted and recorded separately. Timeouts are not part of the transient retries:
 * three waits of several minutes would stall the whole council. Two follow-ups exist on top (#146, #147):
 * an overloaded or rate-limited provider gets one late retry after `TRANSIENT_RETRY_DELAY_MS`, and a timeout
 * repair that is then cut off at the output limit gets one last attempt with a doubled limit.
 *
 * Bounds (#172, #175): a participant that was cut off once starts every later call with the raised limit; a
 * repeating runaway answer is asked again with a length instruction instead of a doubled limit; all follow-ups of
 * one call end within `CALL_DEADLINE_FACTOR` × its timeout; and after `PHASE_FAILURE_LIMIT` provider-side failures
 * of a model in one phase its remaining calls of that phase fail at once instead of waiting again.
 */
export async function callStructured<T extends z.ZodType>(
  ctx: SessionContext,
  resolveAdapter: AdapterResolver,
  participant: Participant,
  phase: Phase,
  request: StructuredRequest<T>,
): Promise<z.output<T>> {
  const key = `${phase}:${participant.id}`;
  const earlier = ctx.providerFailures.get(key);
  if (earlier && earlier.count >= PHASE_FAILURE_LIMIT) {
    throw new ParticipantCallError(
      participant.id,
      `skipped: ${earlier.count} calls of this model already failed in this phase (last: ${earlier.last.replaceAll("_", " ")})`,
      { kind: earlier.last },
    );
  }
  try {
    // A model that already failed in this phase gets no late retry and no timeout repair: they would only wait again.
    return await callWithFollowUps(ctx, resolveAdapter, participant, phase, request, Boolean(earlier));
  } catch (error) {
    if (error instanceof ParticipantCallError && PROVIDER_FAILURE_KINDS.has(error.kind)) {
      ctx.providerFailures.set(key, { count: (ctx.providerFailures.get(key)?.count ?? 0) + 1, last: error.kind });
    }
    throw error;
  }
}

interface Chain {
  baseOutput: number;
  timeoutMs: number;
  /** Epoch ms after which no follow-up of this call starts. */
  deadline: number;
}

/** Timeout for a follow-up attempt, or null when too little of the call's deadline is left to start one. */
function followUpTimeout(chain: Chain, wanted: number): number | null {
  const left = chain.deadline - Date.now();
  return left < chain.timeoutMs * MIN_FOLLOW_UP_SHARE ? null : Math.min(wanted, left);
}

async function callWithFollowUps<T extends z.ZodType>(
  ctx: SessionContext,
  resolveAdapter: AdapterResolver,
  participant: Participant,
  phase: Phase,
  request: StructuredRequest<T>,
  degraded: boolean,
): Promise<z.output<T>> {
  const policyOutput = outputTokensFor(participant.provider, ctx.policy.maxOutputTokens, request.schemaName, request.items);
  // A participant cut off earlier in this run starts at the limit that was raised for it (#172).
  const baseOutput = Math.min(MAX_REPAIR_OUTPUT_TOKENS, Math.max(policyOutput, ctx.outputFloors.get(participant.id) ?? 0));
  const timeoutMs = callTimeoutFor(participant.provider, ctx.policy.callTimeoutMs);
  const chain: Chain = { baseOutput, timeoutMs, deadline: Date.now() + Math.round(timeoutMs * CALL_DEADLINE_FACTOR) };
  let first: ParticipantCallError;
  try {
    return await attempt(ctx, resolveAdapter, participant, phase, request, baseOutput, timeoutMs);
  } catch (error) {
    if (!(error instanceof ParticipantCallError)) throw error;
    first = error;
  }
  if (!first.transient) {
    if (first.repair && !(degraded && first.repair.kind === "timeout")) return repair(ctx, resolveAdapter, participant, phase, request, first, chain);
    throw first;
  }
  if (degraded) throw first;
  // Budget and cancellation are checked again by the late attempt itself.
  await waitUnlessCancelled(ctx, ctx.transientRetryDelayMs);
  const lateTimeout = followUpTimeout(chain, timeoutMs);
  if (lateTimeout === null) throw first;
  try {
    return await attempt(ctx, resolveAdapter, participant, phase, request, baseOutput, lateTimeout);
  } catch (error) {
    if (!(error instanceof ParticipantCallError) || !error.repair) throw error;
    return repair(ctx, resolveAdapter, participant, phase, request, error, chain);
  }
}

async function repair<T extends z.ZodType>(
  ctx: SessionContext,
  resolveAdapter: AdapterResolver,
  participant: Participant,
  phase: Phase,
  request: StructuredRequest<T>,
  failure: ParticipantCallError,
  chain: Chain,
): Promise<z.output<T>> {
  const cause = failure.repair!;
  const { baseOutput, timeoutMs } = chain;
  // Cut off: a doubled limit, remembered for the participant's later calls (#172). A runaway keeps its limit and
  // gets a length instruction instead – more room only means more repetition (#175).
  const truncated = cause.kind === "max_tokens";
  const maxOutput = truncated ? Math.min(baseOutput * 2, MAX_REPAIR_OUTPUT_TOKENS) : baseOutput;
  if (truncated) ctx.raiseOutputFloor(participant.id, maxOutput);
  const retryTimeout = followUpTimeout(chain, cause.kind === "timeout" ? Math.round(timeoutMs * TIMEOUT_REPAIR_FACTOR) : timeoutMs);
  if (retryTimeout === null) throw failure;
  const repaired = { ...request, check: request.repairCheck ?? request.check, prompt: `${request.prompt}\n\n${repairNote(cause)}` };
  try {
    return await attempt(ctx, resolveAdapter, participant, phase, repaired, maxOutput, retryTimeout);
  } catch (error) {
    // A slow model asked to hurry often writes a long answer that the unchanged limit cuts off (#147, Kimi K2.6):
    // one last attempt with a doubled limit instead of dropping the model.
    if (cause.kind !== "timeout" || !(error instanceof ParticipantCallError) || error.repair?.kind !== "max_tokens") throw error;
    const lastOutput = Math.min(baseOutput * 2, MAX_REPAIR_OUTPUT_TOKENS);
    ctx.raiseOutputFloor(participant.id, lastOutput);
    const lastTimeout = followUpTimeout(chain, retryTimeout);
    if (lastTimeout === null) throw error;
    return attempt(
      ctx,
      resolveAdapter,
      participant,
      phase,
      { ...repaired, prompt: `${request.prompt}\n\n${repairNote(error.repair)}` },
      lastOutput,
      lastTimeout,
    );
  }
}

async function attempt<T extends z.ZodType>(
  ctx: SessionContext,
  resolveAdapter: AdapterResolver,
  participant: Participant,
  phase: Phase,
  request: StructuredRequest<T>,
  maxOutput: number,
  timeoutMs: number,
): Promise<z.output<T>> {
  const session = await ctx.reload();
  if (session.status === "cancel_requested" || session.status === "cancelled") throw new CancelledError();
  const estimatedInput = Math.ceil((request.system.length + (ctx.policy.customRules?.length ?? 0) + request.prompt.length) / CHARS_PER_TOKEN);
  // #243: the request must be possible for this model – output at most what it can write and what its window leaves.
  // Content is never shortened; a call that cannot fit is not sent.
  const size = fitCallToModel(estimatedInput, maxOutput, await ctx.modelLimits(participant.provider, participant.modelId));
  if (!size.ok) throw new ParticipantCallError(participant.id, `${participant.modelId}: ${size.reason}`, { kind: "context_window" });
  maxOutput = size.maxOutput;
  // Atomic reservation: parallel calls cannot jointly overrun the budget. The reservation is
  // replaced by the actual usage afterwards.
  const reservation = estimatedInput + maxOutput;
  // Earlier phases leave the Final Verdict's share untouched (#148).
  const keep = ctx.verdictReserve;
  const reserved = await ctx.db
    .update(schema.councilSession)
    .set({ tokensUsed: sql`${schema.councilSession.tokensUsed} + ${reservation}` })
    .where(
      and(
        eq(schema.councilSession.id, ctx.session.id),
        sql`${schema.councilSession.tokensUsed} + ${reservation} + ${keep} <= ${schema.councilSession.tokenBudget}`,
      ),
    )
    .returning({ id: schema.councilSession.id });
  if (reserved.length === 0) {
    throw new DomainError(
      "BUDGET_EXCEEDED",
      keep > 0
        ? `Token budget of ${session.tokenBudget.toLocaleString("en-US")} would leave too little for the Final Verdict`
        : `Token budget of ${session.tokenBudget.toLocaleString("en-US")} would be exceeded`,
    );
  }

  // #244: a system prompt identical for the whole council and the brief first, so providers can cache the shared prefix.
  const stable = stablePrompt(request.system, request.prompt, ctx.policy.customRules);
  const system = stable.system;
  const started = Date.now();
  let outcome: (typeof schema.usageOutcome.enumValues)[number] = "ok";
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  // Why the call failed, stored with the usage row (#175).
  let errorKind: CallErrorKind | null = null;
  let httpStatus: number | null = null;
  // Set when our own call timeout ended the request; adapters report any abort as "cancelled".
  let timedOut = false;
  try {
    // Inside the try: a key deleted during the run must release the reservation and name the cause (#30).
    let adapter: ProviderAdapter;
    try {
      adapter = await resolveAdapter(participant);
    } catch (error) {
      outcome = "error";
      const cause = redactSecrets(error instanceof Error ? error.message : "unknown");
      console.warn(JSON.stringify({ level: "warn", message: "credential unavailable", provider: participant.provider, model: participant.modelId, cause }));
      // Never a fallback to another key: this model stops, the run decides whether it can continue.
      throw new ParticipantCallError(participant.id, `No usable API key for ${participant.provider}: ${cause}`, { kind: "credential" });
    }
    const result = await withRetry(
      async () => {
        const signal = timeoutSignal(timeoutMs);
        try {
          return await adapter.generate({
            model: participant.modelId,
            system,
            messages: [{ role: "user", content: stable.prompt }],
            ...(stable.cachePrefix ? { cachePrefix: stable.cachePrefix } : {}),
            maxOutputTokens: maxOutput,
            jsonSchema: { name: request.schemaName, schema: toProviderJsonSchema(request.schema) },
            signal,
          });
        } catch (error) {
          if (!signal.aborted) throw error;
          timedOut = true;
          // Not a ProviderError, so the transient retries stop here; the repair path decides.
          throw new Error("Call timed out", { cause: error });
        }
      },
      ctx.retrySleep ? { ...DEFAULT_RETRY, sleep: ctx.retrySleep } : DEFAULT_RETRY,
    );
    usage = result.usage;
    if (result.stopReason === "refusal") {
      outcome = "refusal";
      throw new ParticipantCallError(participant.id, "The model declined to answer", { kind: "refusal" });
    }
    if (result.stopReason === "max_tokens") {
      outcome = "max_tokens";
      // A runaway (the same text again and again) is asked again with a length instruction, not a larger limit (#175).
      if (looksRepetitive(result.text)) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "repetitive answer cut off",
            provider: participant.provider,
            model: participant.modelId,
            schema: request.schemaName,
            outputTokens: usage.outputTokens,
          }),
        );
        throw new ParticipantCallError(participant.id, "The answer kept repeating itself until the output limit", {
          kind: "runaway",
          repair: { kind: "runaway", detail: "repeating output" },
        });
      }
      throw new ParticipantCallError(participant.id, "The answer was cut off at the output limit", {
        kind: "max_tokens",
        repair: { kind: "max_tokens", detail: "output limit" },
      });
    }
    const parsed = request.schema.safeParse(result.json);
    // Some providers report a JSON answer cut at the output limit as finished (DeepSeek, test cases 30.10.26): no
    // parsable JSON and output at the limit is a cut-off answer – repaired as one (concise, larger limit).
    // The provider may also clamp the limit below ours (DeepSeek: about 8k), so an unclosed JSON text counts too.
    const cutOff = usage.outputTokens >= maxOutput * 0.95 || (result.text.trim().startsWith("{") && !result.text.trim().endsWith("}"));
    if (!parsed.success && result.json == null && cutOff) {
      outcome = "max_tokens";
      throw new ParticipantCallError(participant.id, "The answer was cut off at the output limit", {
        kind: "max_tokens",
        repair: { kind: "max_tokens", detail: "output limit (reported as finished)" },
      });
    }
    if (!parsed.success) {
      outcome = "invalid_output";
      // Diagnostics without content: which provider/model, whether any JSON came back, which fields failed.
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "invalid structured output",
          provider: participant.provider,
          model: participant.modelId,
          json: result.json !== undefined,
          textLength: result.text.length,
          issues: describeIssues(parsed.error).slice(0, 300),
        }),
      );
      await dumpInvalidOutput(participant, request.schemaName, result.text);
      throw new ParticipantCallError(participant.id, "The answer did not match the required structure", {
        kind: "schema",
        repair: { kind: "invalid_output", detail: describeIssues(parsed.error) },
      });
    }
    const problem = request.check?.(parsed.data);
    if (problem) {
      outcome = "invalid_output";
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "answer failed content check",
          provider: participant.provider,
          model: participant.modelId,
          schema: request.schemaName,
          problem: problem.slice(0, 300),
        }),
      );
      throw new ParticipantCallError(participant.id, "The answer mixed up the proposals it evaluated", {
        kind: "mismatch",
        repair: { kind: "mismatch", detail: problem },
      });
    }
    return parsed.data;
  } catch (error) {
    if (outcome === "ok") outcome = "error";
    if (error instanceof ParticipantCallError) {
      errorKind = error.kind;
      throw error;
    }
    errorKind = timedOut ? "timeout" : error instanceof ProviderError ? providerErrorKind(error) : "provider_error";
    httpStatus = error instanceof ProviderError ? (error.status ?? null) : null;
    // Content-free diagnostics for failed provider calls (timeout, rate limit, 5xx, auth) after the retries.
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "provider call failed",
        provider: participant.provider,
        model: participant.modelId,
        schema: request.schemaName,
        kind: timedOut ? "timeout" : error instanceof ProviderError ? error.kind : "unknown",
        status: error instanceof ProviderError ? (error.status ?? null) : null,
        durationMs: Date.now() - started,
      }),
    );
    if (timedOut) {
      throw new ParticipantCallError(participant.id, `${participant.provider} timeout`, {
        kind: "timeout",
        repair: { kind: "timeout", detail: `no answer within ${Math.round(timeoutMs / 1000)} s` },
      });
    }
    if (error instanceof ProviderError) {
      // Overload and rate limits are named as such, so the UI can tell them from invalid answers (#146).
      const reason =
        error.kind === "unavailable"
          ? `${error.provider} overloaded or unavailable${error.status ? ` (HTTP ${error.status})` : ""}`
          : error.kind === "rate_limit"
            ? `${error.provider} rate limit${error.status ? ` (HTTP ${error.status})` : ""}`
            : error.kind === "model_not_found"
              ? `${participant.modelId} is not available for this ${error.provider} key (HTTP 404)`
              : `${error.provider} ${error.kind}`;
      throw new ParticipantCallError(participant.id, reason, {
        kind: errorKind,
        transient: error.kind === "unavailable" || error.kind === "rate_limit",
        httpStatus: error.status,
      });
    }
    throw new ParticipantCallError(participant.id, "Provider call failed", { kind: "provider_error" });
  } finally {
    const total = usage.inputTokens + usage.outputTokens;
    const correction = total - reservation;
    await ctx.db.insert(schema.usageRecord).values({
      id: newId("use"),
      organizationId: ctx.orgId,
      sessionId: ctx.session.id,
      participantId: participant.id,
      phase,
      provider: participant.provider,
      modelId: participant.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      durationMs: Date.now() - started,
      outcome,
      errorKind,
      httpStatus,
    });
    if (correction !== 0) {
      await ctx.db
        .update(schema.councilSession)
        .set({ tokensUsed: sql`greatest(0, ${schema.councilSession.tokensUsed} + ${correction})` })
        .where(eq(schema.councilSession.id, ctx.session.id));
    }
  }
}

/** Error kind of a provider failure as stored and shown (#175): "overloaded" for 5xx, "network" without a status. */
function providerErrorKind(error: ProviderError): CallErrorKind {
  switch (error.kind) {
    case "unavailable":
      return error.status ? "overloaded" : "network";
    case "rate_limit":
    case "timeout":
    case "auth":
    case "model_not_found":
    case "bad_request":
      return error.kind;
    case "invalid_output":
      return "schema";
    default:
      return "provider_error";
  }
}

/**
 * Development only: keeps the raw text of an answer that could not be parsed in `.data/debug/` (git-ignored, next
 * to the local database) so provider quirks can be diagnosed. Never in production and never in the logs.
 */
async function dumpInvalidOutput(participant: Participant, schemaName: string, text: string) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const dir = join(process.cwd(), ".data", "debug");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `invalid-${participant.provider}-${participant.modelId}-${schemaName}-${Date.now()}.txt`), text.slice(0, 50_000));
  } catch {
    // Diagnostics must never break a council run.
  }
}

/** Short, content-free summary of schema violations (paths and messages only) for the repair prompt. */
function describeIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Runs calls in parallel and separates successes from per-participant failures. */
export async function settle<T>(items: Array<{ participant: Participant; run: () => Promise<T> }>) {
  const results = await Promise.allSettled(items.map((item) => item.run()));
  const ok: Array<{ participant: Participant; value: T }> = [];
  const failed: Array<{ participant: Participant; reason: string; kind: CallErrorKind | null }> = [];
  results.forEach((result, index) => {
    const participant = items[index]!.participant;
    if (result.status === "fulfilled") ok.push({ participant, value: result.value });
    else if (result.reason instanceof CancelledError || (result.reason instanceof DomainError && result.reason.code === "BUDGET_EXCEEDED")) throw result.reason;
    else
      failed.push({
        participant,
        reason: result.reason instanceof Error ? result.reason.message : "Unknown error",
        kind: result.reason instanceof ParticipantCallError ? result.reason.kind : null,
      });
  });
  return { ok, failed };
}
