import type { GenerateRequest, GenerateResult, ProviderAdapter } from "@consyrium/ai";
import type { ScriptedAdapter } from "../../council/test/scripted-adapter";

/** TEST DOUBLE: answers planning/coding/review prompts with fixed engineering output. */
export class ScriptedEngineer implements ProviderAdapter {
  readonly provider = "anthropic" as const;
  readonly requests: GenerateRequest[] = [];
  constructor(
    private readonly council: ScriptedAdapter,
    private readonly options: {
      badPath?: boolean;
      reviewVerdict?: "approve" | "request_changes";
      outputTokens?: number;
      parallelSameFile?: boolean;
      /** Number of coding answers cut off at the output limit before complete ones (thinking models). */
      truncatedFileChanges?: number;
      /** Number of coding answers that miss the schema before valid ones (GitHub build test 08.11.26). */
      malformedFileChanges?: number;
    } = {},
  ) {
    this.truncatedLeft = options.truncatedFileChanges ?? 0;
    this.malformedLeft = options.malformedFileChanges ?? 0;
  }
  private truncatedLeft: number;
  private malformedLeft: number;
  async listModels() {
    return [];
  }
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const name = request.jsonSchema!.name;
    if (!["development_plan", "file_changes", "code_review"].includes(name)) return this.council.generate(request);
    this.requests.push(request);
    const prompt = request.messages[0]!.content;
    if (name === "file_changes" && this.truncatedLeft > 0) {
      this.truncatedLeft -= 1;
      return { provider: "anthropic", model: "scripted", text: "{", json: undefined, stopReason: "max_tokens", usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: request.maxOutputTokens } };
    }
    if (name === "file_changes" && this.malformedLeft > 0) {
      this.malformedLeft -= 1;
      return { provider: "anthropic", model: "scripted", text: "{}", json: { summary: 42 }, stopReason: "completed", usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: 10 } };
    }
    let json: unknown;
    if (name === "development_plan" && this.options.parallelSameFile) {
      json = {
        summary: "Two independent tasks touching one file",
        stack: "node",
        installCommand: "npm install",
        testCommand: "npm test",
        tasks: [
          { key: "T1", title: "Add a", description: "export a", acceptanceCriteria: ["a exported"], dependsOn: [] },
          { key: "T2", title: "Add b", description: "export b", acceptanceCriteria: ["b exported"], dependsOn: [] },
        ],
      };
    } else if (name === "file_changes" && this.options.parallelSameFile) {
      const isT2 = prompt.includes('key="T2"');
      // T2 is slow on its first attempt, so T1 changes the shared file in the meantime.
      if (isT2 && !prompt.includes("another task changed")) await new Promise((r) => setTimeout(r, 80));
      const current = /<file path="src\/shared.js">\n([\s\S]*?)\n<\/file>/.exec(prompt)?.[1] ?? "";
      json = { summary: isT2 ? "add b" : "add a", files: [{ path: "src/shared.js", action: "write", content: `${current}${isT2 ? "export const b = 2;" : "export const a = 1;"}\n` }] };
    } else if (name === "development_plan") {
      json = {
        summary: "Small API",
        stack: "node",
        installCommand: "npm install",
        testCommand: "npm test",
        tasks: [
          { key: "T1", title: "Scaffold", description: "package.json", acceptanceCriteria: ["npm test runs"], dependsOn: [] },
          { key: "T2", title: "Feature", description: "add sum()", acceptanceCriteria: ["sum works"], dependsOn: ["T1"] },
        ],
      };
    } else if (name === "file_changes") {
      const fixing = prompt.includes("The tests failed");
      json = {
        summary: fixing ? "fix" : "implement",
        files: [
          { path: prompt.includes('key="T1"') ? "package.json" : "src/sum.js", action: "write", content: fixing ? "module.exports = (a, b) => a + b;\n" : prompt.includes('key="T1"') ? '{"name":"demo","scripts":{"test":"node test.js"}}\n' : "module.exports = (a, b) => a - b;\n" },
          ...(this.options.badPath ? [{ path: "../../etc/passwd", action: "write", content: "x" }] : []),
        ],
      };
    } else {
      json = { verdict: this.options.reviewVerdict ?? "approve", findings: [{ severity: "low", file: "src/sum.js", issue: "no input validation", suggestion: "validate numbers" }] };
    }
    return { provider: "anthropic", model: "scripted", text: JSON.stringify(json), json, stopReason: "completed", usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: this.options.outputTokens ?? 200 } };
  }
}

