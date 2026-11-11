/** Minimal client for the Consyrium REST API (personal API token, one workspace). No vscode imports. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ConsyriumApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
}

export interface SessionSummary {
  id: string;
  projectId: string;
  projectName: string;
  mode: string;
  status: string;
  currentPhase: string | null;
  createdAt: string;
}

export type ApprovalAction = "approve" | "reject" | "request_more_debate" | "request_changes" | "select_alternative";

/**
 * The app runs on app.consyrium.com; consyrium.com and the former consyrion.com addresses only redirect there, and a redirect to another host drops the
 * Authorization header – so the old default and the bare domain are mapped to the app (QA 07.11.26).
 */
export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\/((www\.)?consyri(um|on)\.com|app\.consyrion\.com)$/i.test(trimmed) ? "https://app.consyrium.com" : trimmed;
}

export class ConsyriumApi {
  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = normalizeServerUrl(baseUrl);
  }

  private readonly baseUrl: string;

  private async request<T>(path: string, init: RequestInit = {}, raw = false): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new ConsyriumApiError(response.status, body.error?.message ?? `Request failed (${response.status})`);
    }
    if (raw || response.status === 204) return (raw ? await response.text() : undefined) as T;
    // A web page instead of JSON: the server URL points to the website (e.g. a redirecting domain), not the API.
    if ((response.headers.get("content-type") ?? "").includes("text/html"))
      throw new ConsyriumApiError(
        response.status,
        `${this.baseUrl} answered with a web page, not the CONSYRIUM AI API – check the setting consyrium.serverUrl (e.g. https://app.consyrium.com).`,
      );
    return (await response.json()) as T;
  }

  async projects() {
    return (await this.request<{ projects: ProjectSummary[] }>("/api/projects")).projects.filter((p) => p.status !== "archived");
  }

  async sessions(projectId: string) {
    return (await this.request<{ sessions: SessionSummary[] }>(`/api/projects/${encodeURIComponent(projectId)}/sessions`)).sessions;
  }

  session(sessionId: string) {
    return this.request<Record<string, unknown>>(`/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  /** The Markdown report; `language` (en/de/fr/es) sets its fixed wording (#322), model output stays as written. */
  reportMarkdown(sessionId: string, language?: string) {
    const lang = language ? `?lang=${encodeURIComponent(language.toLowerCase().split("-")[0]!)}` : "";
    return this.request<string>(`/api/sessions/${encodeURIComponent(sessionId)}/report${lang}`, {}, true);
  }

  approve(sessionId: string, action: ApprovalAction, comment: string, selectedProposalId?: string) {
    return this.request<{ status: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ action, comment, selectedProposalId }),
    });
  }

  async executions(sessionId: string) {
    return (
      await this.request<{ executions: Array<{ id: string; status: string; createdAt: string }> }>(`/api/sessions/${encodeURIComponent(sessionId)}/executions`)
    ).executions;
  }

  execution(planId: string) {
    return this.request<{
      plan: { id: string; status: string; pullRequestUrl: string | null };
      files: Array<{ path: string; content: string; changed: boolean; before: string | null }>;
      deletedFiles: string[];
      tests: Array<{ kind: string; status: string; command: string }>;
      reviews: Array<{ focus: string; verdict: string }>;
    }>(`/api/executions/${encodeURIComponent(planId)}`);
  }
}
