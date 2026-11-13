import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("unusableModels (cost preview with ?checkModels=1)", () => {
  it("returns only the models the provider answers with 'not found'; errors of the check count as unknown", async () => {
    const { unusableModels } = await import("./model-catalog");
    const probe = vi.fn(async (_credentialId: string, modelId: string) => {
      if (modelId === "gone") return "not_found" as const;
      if (modelId === "boom") throw new Error("network");
      return "ok" as const;
    });
    const result = await unusableModels(
      [
        { credentialId: "c1", modelId: "fine" },
        { credentialId: "c1", modelId: "gone" },
        { credentialId: "c2", modelId: "boom" },
      ],
      probe,
    );
    expect(result).toEqual([{ credentialId: "c1", modelId: "gone" }]);
    expect(probe).toHaveBeenCalledTimes(3);
  });
});
