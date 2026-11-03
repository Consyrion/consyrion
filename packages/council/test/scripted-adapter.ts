/**
 * TEST DOUBLE: deterministic "models" for engine tests. They answer every council step with
 * schema-valid JSON derived from the prompt (labels, ids). Never used outside tests.
 */
import { ProviderError, type GenerateRequest, type GenerateResult, type ProviderAdapter } from "@consyrion/ai";

export interface Script {
  /** Title of this model's own proposal. */
  title: string;
  /** Labels whose proposal this model prefers in the 12 Minds Council (falls back to first other label). */
  prefer?: (labels: string[], ownTitle: string, prompt: string) => string;
  /** Critiques this model raises against proposals whose title matches. */
  critiques?: Array<{ againstTitle: string; claim: string; category: string; severity: string }>;
  adjudicate?: (objectionClaim: string) => "refuted" | "resolved" | "accepted" | "unresolved";
  score?: (title: string) => number;
  fail?: boolean;
  usage?: number;
  /** Number of evaluation answers that come back schema-invalid before valid ones (Infinity = always). */
  invalidEvaluations?: number;
  /** The proposal answer waits for this promise (simulates a slow model during the blind phase). */
  proposalGate?: Promise<void>;
  /** Number of proposal requests that never answer and end only when the call timeout aborts them. */
  hangingProposals?: number;
  /** Number of proposal requests answered with HTTP 503 (provider overloaded) before a normal answer (#146). */
  unavailableProposals?: number;
  /** Number of proposal answers that are cut off at the output limit before a complete one. */
  truncatedProposals?: number;
  /** Final Verdict answers cut off but reported as finished (DeepSeek, test cases 30.10.26). */
  silentlyTruncatedEvaluations?: number;
  /** Number of proposal answers that repeat the same passage until the output limit (a runaway, #175). */
  runawayProposals?: number;
  /** Schemas this model always answers with HTTP 503 (a provider that stays overloaded for that step, #175). */
  unavailableFor?: string[];
  /**
   * Number of evaluation answers that describe and argue about this model's OWN proposal under the other
   * proposals' labels (the label mix-up of #93) before correct ones (Infinity = always).
   */
  mixedUpEvaluations?: number;
  /** As evaluator, always restates the title `as` for the proposal titled `of` – one mix-up among correct ones (#145). */
  mixesUpTitle?: { of: string; as: string };
  /** As evaluator, never returns a valid evaluation (e.g. a provider that keeps breaking the structure). */
  failsEvaluation?: boolean;
  /** This model finds the hard requirements contradictory: its proposals are findings, not solutions (#121). */
  unsolvable?: boolean;
  /** As evaluator, this model finds that no proposal meets the hard requirements (#121). */
  judgesUnsolvable?: boolean;
  /**
   * Gate version 2 (#181): the status this evaluator gives per requirement id for proposals with this title; default
   * PASS with every part met. Return null to leave the requirement out of the answer.
   */
  requirementCheck?: (
    title: string,
    requirementId: string,
  ) => { status: "PASS" | "FAIL" | "UNKNOWN"; allPartsMet?: boolean; estimate?: { low: number; high: number } | null } | null;
  /** Concede every objection against this model's proposal in the Minority Review. */
  concede?: boolean;
  /**
   * Number of revisions that keep the position and claim a change but return the unchanged content (the
   * #94 defect) before correct ones (Infinity = always).
   */
  hollowRevisions?: number;
  /**
   * Number of consensus summaries that call measures missing which the current revision contains (the #105
   * defect) before correct ones (Infinity = always).
   */
  staleSummaries?: number;
  /** Each adjudication answer takes this long (simulates a slow judge, #184). */
  adjudicationDelayMs?: number;
  /** Runs before each adjudication answer, e.g. to change the session budget while the phase runs (#184). */
  beforeAdjudication?: () => Promise<void>;
}

const labelsIn = (prompt: string) =>
  [...prompt.matchAll(/<proposal label="([A-Z])"[^>]*>\n([\s\S]*?)\n<\/proposal>/g)].map((m) => ({
    label: m[1]!,
    title: (JSON.parse(m[2]!) as { title: string }).title,
  }));
const idsIn = (prompt: string, tag: string) =>
  [...prompt.matchAll(new RegExp(`<${tag} id="([^"]+)"[^>]*>([^<]*)`, "g"))].map((m) => ({ id: m[1]!, text: m[2]! }));

export function proposal(title: string, solves = true) {
  return {
    title,
    summary: `${title} summary`,
    architecture: `${title} architecture`,
    components: ["api", "worker"],
    advantages: [`${title} is simple`],
    disadvantages: [`${title} has limits`],
    risks: [{ risk: `${title} risk`, severity: "medium", mitigation: "monitoring" }],
    costEstimate: "moderate",
    assumptions: ["team of 3"],
    recommendations: [`Build ${title} MVP`],
    confidence: 70,
    solvesRequirements: solves,
    requirementConflicts: solves ? [] : ["H1 forbids every channel between the sites", "H2 requires every booking at the other site within one second"],
  };
}

export class ScriptedAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;
  readonly requests: GenerateRequest[] = [];
  private invalidLeft: number;
  private truncatedLeft: number;
  private silentLeftUsed = 0;
  private hangingLeft: number;
  private mixedUpLeft: number;
  private hollowLeft: number;
  private staleLeft: number;
  /** Real revisions so far – each one changes the content, like a model that actually revises. */
  private revisions = 0;
  constructor(readonly script: Script) {
    this.hollowLeft = script.hollowRevisions ?? 0;
    this.staleLeft = script.staleSummaries ?? 0;
    this.invalidLeft = script.invalidEvaluations ?? 0;
    this.mixedUpLeft = script.mixedUpEvaluations ?? 0;
    this.truncatedLeft = script.truncatedProposals ?? 0;
    this.hangingLeft = script.hangingProposals ?? 0;
    this.unavailableLeft = script.unavailableProposals ?? 0;
    this.runawayLeft = script.runawayProposals ?? 0;
  }
  private runawayLeft: number;
  private unavailableLeft: number;
  /** Start and end (ms) of every answered adjudication request, to check that calls overlap (#184). */
  readonly adjudicationSpans: Array<{ start: number; end: number }> = [];
  private adjudicating = 0;
  /** Most adjudication requests this model answered at the same time. */
  maxParallelAdjudications = 0;

  async listModels() {
    return [];
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(request);
    if (this.script.fail) throw new Error("scripted failure");
    const prompt = request.messages[0]!.content;
    const usage = {
      inputTokens: Math.ceil(((request.system ?? "").length + prompt.length) / 4),
      outputTokens: Math.min(this.script.usage ?? 100, request.maxOutputTokens),
    };
    if (request.jsonSchema!.name === "evaluation" && this.invalidLeft > 0) {
      this.invalidLeft -= 1;
      return { provider: "anthropic", model: "scripted", text: "{}", json: { evaluations: "not a list" }, stopReason: "completed", usage };
    }
    if (this.script.unavailableFor?.includes(request.jsonSchema!.name)) throw new ProviderError("anthropic", "unavailable", "The model is overloaded", 503);
    if (request.jsonSchema!.name === "proposal" && this.script.proposalGate) await this.script.proposalGate;
    if (request.jsonSchema!.name === "adjudication" && (this.script.adjudicationDelayMs || this.script.beforeAdjudication)) {
      const start = Date.now();
      this.adjudicating += 1;
      this.maxParallelAdjudications = Math.max(this.maxParallelAdjudications, this.adjudicating);
      await this.script.beforeAdjudication?.();
      if (this.script.adjudicationDelayMs) await new Promise((r) => setTimeout(r, this.script.adjudicationDelayMs));
      this.adjudicating -= 1;
      this.adjudicationSpans.push({ start, end: Date.now() });
    }
    if (request.jsonSchema!.name === "proposal" && this.runawayLeft > 0) {
      this.runawayLeft -= 1;
      const loop = Array.from({ length: 200 }, () => "The service validates every request against the schema before storing it.").join(" ");
      return {
        provider: "anthropic",
        model: "scripted",
        text: `{"title": "${this.script.title}", "summary": "${loop}`,
        json: undefined,
        stopReason: "max_tokens",
        usage,
      };
    }
    if (request.jsonSchema!.name === "proposal" && this.unavailableLeft > 0) {
      this.unavailableLeft -= 1;
      throw new ProviderError("anthropic", "unavailable", "The model is overloaded", 503);
    }
    if (request.jsonSchema!.name === "proposal" && this.hangingLeft > 0) {
      this.hangingLeft -= 1;
      // Like a real adapter: an aborted request surfaces as a cancelled provider error.
      await new Promise((_, reject) =>
        request.signal?.addEventListener("abort", () => reject(new ProviderError("anthropic", "cancelled", "Request was cancelled or timed out")), {
          once: true,
        }),
      );
    }
    if (request.jsonSchema!.name === "evaluation" && (this.script.silentlyTruncatedEvaluations ?? 0) > this.silentLeftUsed) {
      this.silentLeftUsed += 1;
      return {
        provider: "anthropic",
        model: "scripted",
        text: '{"evaluations":[{"proposalLabel":"A","requirementChecks":[',
        json: undefined,
        stopReason: "completed",
        usage,
      };
    }
    if (request.jsonSchema!.name === "proposal" && this.truncatedLeft > 0) {
      this.truncatedLeft -= 1;
      return { provider: "anthropic", model: "scripted", text: "{", json: undefined, stopReason: "max_tokens", usage };
    }
    const proposals = labelsIn(prompt);
    const own = this.script.title;
    let json: unknown;
    switch (request.jsonSchema!.name) {
      case "proposal":
        json = proposal(own, !this.script.unsolvable);
        break;
      case "open_council":
        json = {
          commonGround: ["both use an API"],
          keyDifferences: ["storage"],
          questions: proposals.filter((p) => p.title !== own).map((p) => ({ proposalLabel: p.label, question: `Why ${p.title}?` })),
        };
        break;
      case "answers":
        json = { answers: idsIn(prompt, "question").map((q) => ({ questionId: q.id, answer: "Because it fits." })) };
        break;
      case "role_review": {
        const labels = proposals.map((p) => p.label);
        const preferred = this.script.prefer?.(labels, own, prompt) ?? proposals.find((p) => p.title !== own)?.label ?? labels[0]!;
        json = {
          reviews: proposals.map((p) => {
            const critiques = (this.script.critiques ?? [])
              .filter((c) => c.againstTitle === p.title)
              .map((c) => ({ claim: c.claim, category: c.category, severity: c.severity, evidence: "see architecture" }));
            return { proposalLabel: p.label, noSubstantiatedObjection: critiques.length === 0, critiques };
          }),
          preferredProposalLabel: preferred,
          preferenceReason: "best fit",
        };
        break;
      }
      case "rebuttals":
        json = { rebuttals: idsIn(prompt, "critique").map((c) => ({ critiqueId: c.id, response: "We disagree, see design.", concedes: false })) };
        break;
      case "objection_responses":
        json = {
          responses: idsIn(prompt, "objection").map((o) => ({
            objectionId: o.id,
            response: this.script.concede ? "Correct, we will remove it." : "Mitigated by design.",
            evidence: "doc",
            concedes: Boolean(this.script.concede),
          })),
        };
        break;
      case "adjudication":
        json = {
          verdicts: idsIn(prompt, "objection").map((o) => ({ objectionId: o.id, status: this.script.adjudicate?.(o.text) ?? "refuted", reason: "assessed" })),
        };
        break;
      case "revision":
        if (this.hollowLeft > 0) {
          this.hollowLeft -= 1;
          // Claims to remove something but returns the original content unchanged.
          json = {
            keepPosition: true,
            reason: "keep core idea",
            content: proposal(own, !this.script.unsolvable),
            changes: [{ change: "Removed the invented thresholds", motivatedBy: idsIn(prompt, "objection").map((o) => o.id) }],
          };
        } else {
          this.revisions += 1;
          const summary = this.revisions === 1 ? `${own} revised` : `${own} revised ${this.revisions}`;
          json = {
            keepPosition: false,
            reason: "address critiques",
            content: { ...proposal(own, !this.script.unsolvable), summary },
            changes: [{ change: "added auth", motivatedBy: idsIn(prompt, "objection").map((o) => o.id) }],
          };
        }
        break;
      case "hybrid":
        json = {
          shouldCreateHybrid: true,
          rationale: "combine strengths",
          sourceLabels: proposals.map((p) => p.label),
          content: proposal("Hybrid", !this.script.unsolvable),
        };
        break;
      case "consensus_summary":
        if (this.staleLeft > 0) {
          this.staleLeft -= 1;
          // Repeats an outdated objection: the named proposal's current content has exactly these measures.
          json = {
            status: "partial",
            agreements: ["use an API"],
            disagreements: [`Proposal ${proposals[0]!.label} lacks monitoring, a worker and an architecture.`, "storage"],
            outstandingRisks: [],
          };
        } else json = { status: "partial", agreements: ["use an API"], disagreements: ["storage"], outstandingRisks: [] };
        break;
      case "evaluation": {
        if (this.script.failsEvaluation) {
          json = { evaluations: "not a list" };
          break;
        }
        const mixedUp = this.mixedUpLeft > 0;
        if (mixedUp) this.mixedUpLeft -= 1;
        // Gate version 2 asks for one check per confirmed requirement id listed in the brief (#181).
        const v2 = JSON.stringify(request.jsonSchema!.schema).includes("requirementChecks");
        const block = /<confirmed_requirements[^>]*>([\s\S]*?)<\/confirmed_requirements>/.exec(`${request.system ?? ""}\n${prompt}`)?.[1] ?? "";
        const requirementIds = [...block.matchAll(/^(R\d+): /gm)].map((m) => m[1]!);
        // Measured requirements ([estimate: at most|at least N …]): a range that keeps the limit for PASS, misses it for
        // FAIL and straddles it for UNKNOWN, unless the script gives its own estimate.
        const limits = new Map(
          [...block.matchAll(/^(R\d+): .*\[estimate: (at most|at least|below|above) ([\d.]+)/gm)].map((m) => [
            m[1]!,
            { max: m[2] === "at most" || m[2] === "below", value: Number(m[3]) },
          ]),
        );
        const estimateFor = (requirementId: string, status: "PASS" | "FAIL" | "UNKNOWN") => {
          const l = limits.get(requirementId);
          if (!l) return null;
          const v = l.value;
          if (status === "PASS") return l.max ? { low: v * 0.75, high: v } : { low: v, high: Math.min(100, v + 0.3) };
          if (status === "FAIL") return l.max ? { low: v * 1.25, high: v * 1.5 } : { low: v - 2, high: v - 1 };
          return l.max ? { low: v * 0.75, high: v * 1.25 } : { low: v - 1, high: Math.min(100, v + 0.3) };
        };
        json = {
          evaluations: proposals.map((p) => {
            const s = this.script.score?.(p.title) ?? 7;
            // A mixed-up evaluator talks about its own proposal while naming another label.
            const about = mixedUp ? own : this.script.mixesUpTitle?.of === p.title ? this.script.mixesUpTitle.as : p.title;
            const c = { score: s, rationale: `${about} scored ${s}: ${about} architecture` };
            return {
              proposalLabel: p.label,
              proposalTitle: about,
              proposalSummary: `${about} summary`,
              technicalQuality: c,
              security: c,
              maintainability: c,
              operatingCost: c,
              implementationSpeed: c,
              ...(v2
                ? {
                    requirementChecks: requirementIds.flatMap((requirementId) => {
                      const scripted = this.script.requirementCheck
                        ? this.script.requirementCheck(p.title, requirementId)
                        : { status: this.script.judgesUnsolvable ? ("FAIL" as const) : ("PASS" as const) };
                      if (!scripted) return [];
                      return [
                        {
                          requirementId,
                          status: scripted.status,
                          allPartsMet: scripted.allPartsMet ?? scripted.status === "PASS",
                          evidence: `${about}: ${requirementId} ${scripted.status.toLowerCase()} – see architecture`,
                          ...(() => {
                            const e = scripted.estimate !== undefined ? scripted.estimate : estimateFor(requirementId, scripted.status);
                            return { estimateLow: e?.low ?? null, estimateHigh: e?.high ?? null };
                          })(),
                        },
                      ];
                    }),
                  }
                : {
                    meetsRequirements: !this.script.judgesUnsolvable,
                    requirementsNote: this.script.judgesUnsolvable ? `${about} cannot meet H1 and H2 together` : "meets all hard requirements",
                  }),
            };
          }),
          ranking: [...proposals].sort((a, b) => (this.script.score?.(b.title) ?? 7) - (this.script.score?.(a.title) ?? 7)).map((p) => p.label),
        };
        break;
      }
      default:
        throw new Error(`unknown schema ${request.jsonSchema!.name}`);
    }
    // Input ≈ prompt length / 4 like a real tokenizer; output as scripted (at most the call's limit).
    const inputTokens = Math.ceil(((request.system ?? "").length + prompt.length) / 4);
    const outputTokens = Math.min(this.script.usage ?? 100, request.maxOutputTokens);
    return { provider: "anthropic", model: "scripted", text: JSON.stringify(json), json, stopReason: "completed", usage: { inputTokens, outputTokens } };
  }
}
