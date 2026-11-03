import "server-only";
import { DomainError } from "@consyrion/core";
import { getEntitlements, linkRepository, listGitHubIntegrations, type ActorContext, type Database } from "@consyrion/db";
import { githubAppConfigFromEnv, installationClient, listInstallationRepositories, type GitHubAppConfig } from "@consyrion/github";
import { repositoryFullName } from "../github-url";
import { logger } from "./logger";

export function githubConfig(): GitHubAppConfig | null {
  return githubAppConfigFromEnv(process.env);
}

export function requireGitHubConfig(): GitHubAppConfig {
  const config = githubConfig();
  if (!config) throw new DomainError("CONFIGURATION", "The GitHub App is not configured on this server (see docs/github-app.md)");
  return config;
}

export function stateSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new DomainError("CONFIGURATION", "BETTER_AUTH_SECRET is not set");
  return secret;
}

/**
 * Links the repository named in a new project's brief when GitHub is configured, the plan includes it and
 * one of the workspace's installations covers the repository (checked with GitHub). Best effort: any
 * failure leaves the project unlinked and the user can link it on the project page.
 */
export async function autoLinkRepository(db: Database, actor: ActorContext, projectId: string, repositoryUrl: string | null | undefined) {
  const fullName = repositoryFullName(repositoryUrl);
  const config = githubConfig();
  if (!fullName || !config) return false;
  try {
    if (!(await getEntitlements(db, actor.organizationId)).entitlements.github) return false;
    for (const integration of await listGitHubIntegrations(db, actor)) {
      const repos = await listInstallationRepositories(await installationClient(config, integration.installationId, null));
      const repo = repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
      if (repo) {
        await linkRepository(db, actor, projectId, { integrationId: integration.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch });
        return true;
      }
    }
  } catch (error) {
    logger.warn("auto-link of repository failed", { projectId, reason: error instanceof Error ? error.message : "unknown" });
  }
  return false;
}
