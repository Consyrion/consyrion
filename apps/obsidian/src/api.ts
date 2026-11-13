/**
 * Minimal client for the CONSYRIUM AI REST API with an integration token ("Councils only", prefix cni_). No Obsidian
 * imports: the HTTP call is injected (Obsidian's requestUrl in the plugin, a fake in tests). Only endpoints that accept
 * integration tokens are used – the plugin can never approve, build, merge or read keys.
 */

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}
export interface HttpResponse {
  status: number;
  text: string;
}
export type Http = (request: HttpRequest) => Promise<HttpResponse>;

export type ApiErrorKind = "offline" | "auth" | "forbidden" | "not_found" | "rate_limited" | "validation" | "conflict" | "provider" | "server";

export class ConsyriumError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export interface ModelChoice {
  credentialId: string;
  provider: string;
  label: string;
  models: Array<{ modelId: string; displayName: string }>;
  error: string | null;
}

export interface Participant {
  credentialId: string;
  modelId: string;
}

export type Mode = "independent_expert" | "adversarial_review" | "consensus";

export interface CouncilPreview {
  estimate: { upperBound: number; minimumBudget?: number; typical?: { tokens: number } | null };
  planLimit: string | null;
  finalVerdictSize?: { message?: string | null } | null;
  modelWarnings?: Array<{ message?: string } | string>;
  voteWeightWarnings?: Array<{ message?: string } | string>;
  /** Models the provider lists but refuses to run with this key (asked for with `?checkModels=1`). */
  unusableModels?: Array<{ credentialId: string; modelId: string }>;
}

/** The model names from the server's "provider refuses these models" start error, or null for any other message. */
export function refusedModels(message: string): string | null {
  return /refuses calls with your key \(HTTP 404\): (.+?)\. Choose another model/.exec(message)?.[1] ?? null;
}

export interface Recommendation {
  label?: string;
  author?: string;
  title?: string;
  summary?: string;
  recommendations?: string[];
}

export interface SessionStatus {
  id: string;
  status: string;
  currentPhase: string | null;
  tokensUsed: number;
  tokenBudget: number;
  error: string | null;
  projectName: string;
  /** Models that dropped out, with the reason the server stored – real partial failures, nothing invented. */
  failures: Array<{ modelId: string; reason: string }>;
  models: string[];
}

/**
 * Remote servers need HTTPS; http only for localhost when the user enabled the development option. consyrium.com and
 * the former consyrion.com addresses are mapped to the app host (a redirect to another host would drop the
 * Authorization header).
 */
export function validateServerUrl(raw: string, allowLocalHttp: boolean): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (/^https?:\/\/((www\.)?consyri(um|on)\.com|app\.consyrion\.com)$/i.test(trimmed)) return "https://app.consyrium.com";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConsyriumError("validation", "invalid_url");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:") return trimmed;
  if (url.protocol === "http:" && local && allowLocalHttp) return trimmed;
  throw new ConsyriumError("validation", local ? "local_http_disabled" : "https_required");
}

export class ConsyriumApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly http: Http,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, extra: Record<string, string> = {}, raw = false): Promise<T> {
    let response: HttpResponse;
    try {
      response = await this.http({
        url: `${this.baseUrl}/api${path}`,
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: raw ? "text/markdown" : "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ConsyriumError("offline", "offline");
    }
    if (response.status >= 200 && response.status < 300) return (raw ? response.text : response.text ? JSON.parse(response.text) : {}) as T;
    let message = `HTTP ${response.status}`;
    try {
      message = (JSON.parse(response.text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    const kind: ApiErrorKind =
      response.status === 401
        ? "auth"
        : response.status === 403
          ? "forbidden"
          : response.status === 404
            ? "not_found"
            : response.status === 429
              ? "rate_limited"
              : response.status === 409
                ? "conflict"
                : response.status === 400 || response.status === 422
                  ? /provider|key|model/i.test(message)
                    ? "provider"
                    : "validation"
                  : response.status === 502
                    ? "provider"
                    : "server";
    throw new ConsyriumError(kind, message, response.status);
  }

  async models(): Promise<ModelChoice[]> {
    return (await this.call<{ credentials: ModelChoice[] }>("GET", "/models")).credentials;
  }

  createProject(input: { name: string; idea: string; goal: string; requirements: string[] }) {
    return this.call<{ project: { id: string; name: string } }>("POST", "/projects", {
      name: input.name,
      type: "idea",
      intent: "decision",
      status: "ready",
      brief: { idea: input.idea, goal: input.goal, requirements: input.requirements.map((r) => `- ${r}`).join("\n") },
    });
  }

  requirementProposal(projectId: string) {
    return this.call<{
      proposal: {
        source: { hash: string };
        items: Array<{ text: string; candidateKey?: string | null; source: { kind: string } }>;
        excluded: Array<{ candidateKey: string; reason: string }>;
        toDecide: Array<{ text: string; candidateKey?: string }>;
        pendingImages?: string[];
      };
    }>("GET", `/projects/${projectId}/requirements`);
  }

  confirmRequirements(projectId: string, body: unknown) {
    return this.call<{ list: { version: number } }>("POST", `/projects/${projectId}/requirements`, body);
  }

  preview(projectId: string, input: { mode: Mode; participants: Participant[]; tokenBudget: number }) {
    return this.call<CouncilPreview>("POST", `/projects/${projectId}/sessions/preview?checkModels=1`, input);
  }

  /** Starts the council with an Idempotency-Key: a retry or double click returns the same session instead of a second paid run. */
  start(projectId: string, input: { mode: Mode; participants: Participant[]; tokenBudget: number; confirmBudget: boolean }, idempotencyKey: string) {
    return this.call<{ session: { id: string }; replayed?: boolean }>("POST", `/projects/${projectId}/sessions`, input, { "Idempotency-Key": idempotencyKey });
  }

  async status(sessionId: string): Promise<SessionStatus> {
    const view = await this.call<{
      session: { id: string; status: string; currentPhase: string | null; tokensUsed: number; tokenBudget: number; error: string | null };
      project: { name: string };
      participants?: Array<{ modelId: string; failureReason?: string | null }>;
    }>("GET", `/sessions/${sessionId}`);
    const participants = view.participants ?? [];
    return {
      id: view.session.id,
      status: view.session.status,
      currentPhase: view.session.currentPhase,
      tokensUsed: view.session.tokensUsed,
      tokenBudget: view.session.tokenBudget,
      error: view.session.error,
      projectName: view.project.name,
      failures: participants.filter((p) => p.failureReason).map((p) => ({ modelId: p.modelId, reason: p.failureReason! })),
      models: participants.map((p) => p.modelId),
    };
  }

  report(sessionId: string): Promise<string> {
    return this.call<string>("GET", `/sessions/${sessionId}/report`, undefined, {}, true);
  }

  /** The recommended solution from the structured report – what the note shows first. Null when nothing is recommended. */
  async recommendation(sessionId: string): Promise<Recommendation | null> {
    const report = await this.call<{ recommendedSolution?: Recommendation | null }>("GET", `/sessions/${sessionId}/report?format=json`);
    const solution = report.recommendedSolution;
    return solution && typeof solution === "object" ? solution : null;
  }

  cancel(sessionId: string) {
    return this.call<unknown>("POST", `/sessions/${sessionId}/cancel`, {});
  }
}

/** Session states after which nothing changes any more (the report can be saved). */
export const FINISHED = new Set(["awaiting_approval", "approved", "rejected", "changes_requested", "failed", "cancelled"]);
