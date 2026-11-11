import { DomainError } from "@consyrium/core";
import { createAppJwt, type GitHubAppConfig } from "./app-auth";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Minimal GitHub REST client. Token values are never included in errors or logs. */
export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Consyrium",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new GitHubError(response.status, `GitHub ${method} ${path.split("?")[0]} failed (${response.status}${(detail as { message?: string }).message ? `: ${(detail as { message: string }).message}` : ""})`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}

const PERMISSIONS = {
  /** Listing repositories, reading snapshots, existing pull requests and check runs. */
  read: { contents: "read", pull_requests: "read", checks: "read", metadata: "read" },
  /** Creating the branch, commit and draft pull request – only for that human-triggered action. */
  write: { contents: "write", pull_requests: "write", checks: "read", metadata: "read" },
} as const;

/** Installation token restricted to one repository (when given) and to read or write permissions. */
export async function installationClient(config: GitHubAppConfig, installationId: number, repository: string | null, fetchImpl: FetchLike = fetch, access: "read" | "write" = "read") {
  const app = new GitHubClient(createAppJwt(config), fetchImpl);
  const token = await app.request<{ token: string }>("POST", `/app/installations/${installationId}/access_tokens`, {
    ...(repository ? { repositories: [repository.split("/")[1]] } : {}),
    permissions: PERMISSIONS[access],
  });
  return new GitHubClient(token.token, fetchImpl);
}

/** Upper bound of repositories checked for one installation (10 pages of 100); larger installations are refused. */
export const INSTALLATION_REPOSITORY_CHECK_LIMIT = 1000;

type InstallationRepositoryPage = { total_count: number; repositories: Array<{ full_name: string; permissions?: { admin?: boolean } }> };

/**
 * Exchanges the OAuth code from the installation callback and checks that this GitHub user controls the
 * installation (#394) – seeing it is not enough, because GitHub lists an installation for everybody with
 * read access to one of its repositories:
 * - on a personal account, the user must be that account;
 * - on an organization, the user must have admin rights on every repository the installation covers
 *   (organization owners always do). Checked with the user token against the app's own repository count,
 *   so no extra app permission is needed.
 */
export async function verifyUserInstallation(config: GitHubAppConfig, code: string, installationId: number, fetchImpl: FetchLike = fetch) {
  const response = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
  });
  const token = (await response.json().catch(() => ({}))) as { access_token?: string };
  if (!token.access_token) throw new DomainError("FORBIDDEN", "GitHub authorization failed");
  const user = new GitHubClient(token.access_token, fetchImpl);
  const { installations } = await user.request<{ installations: Array<{ id: number; account: { login: string; type: string }; repository_selection: string }> }>("GET", "/user/installations?per_page=100");
  const match = installations.find((i) => i.id === installationId);
  if (!match) throw new DomainError("FORBIDDEN", "This GitHub installation is not accessible to your GitHub account");
  if (match.account.type === "Organization") await assertOrganizationInstallationAdmin(config, user, installationId, fetchImpl);
  else {
    const me = await user.request<{ login: string }>("GET", "/user");
    if (me.login.toLowerCase() !== match.account.login.toLowerCase()) throw new DomainError("FORBIDDEN", "Only the owner of this GitHub account can connect its installation");
  }
  return { accountLogin: match.account.login, accountType: match.account.type, repositorySelection: match.repository_selection };
}

async function assertOrganizationInstallationAdmin(config: GitHubAppConfig, user: GitHubClient, installationId: number, fetchImpl: FetchLike) {
  const notAdmin = new DomainError("FORBIDDEN", "Connecting this GitHub organization needs admin rights on every repository the app can access – ask an organization owner");
  const app = await installationClient(config, installationId, null, fetchImpl);
  const { total_count: installationTotal } = await app.request<{ total_count: number }>("GET", "/installation/repositories?per_page=1");
  if (installationTotal === 0) throw new DomainError("VALIDATION", "Select at least one repository for the app on GitHub, then connect again");
  if (installationTotal > INSTALLATION_REPOSITORY_CHECK_LIMIT) throw new DomainError("FORBIDDEN", `This installation covers more than ${INSTALLATION_REPOSITORY_CHECK_LIMIT} repositories; limit the app to the repositories you need`);
  let seen = 0;
  for (let page = 1; seen < installationTotal; page++) {
    const batch = await user.request<InstallationRepositoryPage>("GET", `/user/installations/${installationId}/repositories?per_page=100&page=${page}`);
    // The user must see every repository of the installation, with admin rights on each.
    if (batch.total_count !== installationTotal || batch.repositories.length === 0 || batch.repositories.some((r) => r.permissions?.admin !== true)) throw notAdmin;
    seen += batch.repositories.length;
  }
}
