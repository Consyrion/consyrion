import type { DiscoveredModel, GenerateRequest, GenerateResult, ProviderAdapter, ProviderId } from "../types";

/**
 * TEST DOUBLE – never wire this into production code paths. Results are marked with the
 * model id "mock:<name>" so they can never be mistaken for real model output.
 */
export class MockProviderAdapter implements ProviderAdapter {
  readonly isMock = true;
  readonly calls: GenerateRequest[] = [];

  constructor(
    readonly provider: ProviderId,
    private readonly behaviour: {
      models?: DiscoveredModel[];
      respond?: (request: GenerateRequest) => Partial<GenerateResult> | Promise<Partial<GenerateResult>>;
      fail?: Error;
    } = {},
  ) {}

  async listModels(): Promise<DiscoveredModel[]> {
    if (this.behaviour.fail) throw this.behaviour.fail;
    return this.behaviour.models ?? [];
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(request);
    if (this.behaviour.fail) throw this.behaviour.fail;
    const partial = (await this.behaviour.respond?.(request)) ?? {};
    return {
      provider: this.provider,
      model: `mock:${request.model}`,
      text: "",
      json: undefined,
      stopReason: "completed",
      usage: { inputTokens: 0, outputTokens: 0 },
      ...partial,
    };
  }
}
